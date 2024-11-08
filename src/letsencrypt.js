import https from 'https';
import tls from 'tls';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import acme from 'acme-client';

// Configuration constants
const DIRECTORY_URL = acme.directory.letsencrypt.production;
// const DIRECTORY_URL = acme.directory.letsencrypt.staging;

// Determine configuration directory
const CONFIG_DIR = path.join(os.homedir(), '.config', 'web3protocol-http-gateway');
const CERTS_DIR = path.join(CONFIG_DIR, 'certs');



// Utility to check if a directory exists and create it if it doesn't
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch (error) {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// Function to retrieve paths for certificates and keys for a specific domain
function getDomainCertPaths(domain) {
  return {
    privateKeyPath: path.join(CERTS_DIR, `${domain}-key.pem`),
    certPath: path.join(CERTS_DIR, `${domain}-cert.pem`),
    // fullchainPath: path.join(CERTS_DIR, `${domain}-fullchain.pem`)
  };
}

// Function to check if the certificate needs renewal
async function needsRenewal(certPath, thresholdDays, domain) {
  try {
    const certData = await fs.readFile(certPath);
    const certInfo = acme.crypto.readCertificateInfo(certData);
    const now = new Date();
    const expiryDate = certInfo.notAfter;
    const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);
    
    const roundedDaysUntilExpiry = Math.round(daysUntilExpiry);
    console.log(`Certificate for ${domain} expires in ${roundedDaysUntilExpiry} days`);

    return daysUntilExpiry <= thresholdDays;
  } catch (error) {
    console.error(`Error reading certificate for expiry check:`, error);
    // If we can't read the certificate, there must be a bug, let's not spam
    // renewal requests
    return false; 
  }
}

// Function to get or renew the certificate for a specific domain
async function getOrRenewCertificate(app, domain, letsencryptEmail) {
  const { privateKeyPath, certPath/**, fullchainPath*/ } = getDomainCertPaths(domain);

  // Ensure the certs directory exists
  await ensureDirectoryExists(CERTS_DIR);

  // Check if the certificate files already exist
  try {
    const key = await fs.readFile(privateKeyPath);
    const cert = await fs.readFile(certPath);
    // const fullchain = await fs.readFile(fullchainPath);
    
    // Check if the certificate needs renewal
    const renewalRequired = await needsRenewal(certPath, 30, domain);

    // No renewal required? Return the existing certificate
    if (!renewalRequired) {
      console.log(`Certificate for ${domain} found, using existing certificate.`);
      return { key, cert/**, fullchain */ };
    }
      
    console.log(`Certificate for ${domain} found, but it needs renewal. Renewing...`);
  } catch (error) {
    console.log(`Certificate for ${domain} not found, creating a new one...`);
  }

  // Generate account and domain keys
  const accountKey = await acme.crypto.createPrivateKey();
  const client = new acme.Client({
    directoryUrl: DIRECTORY_URL,
    accountKey
  });

  // Create account with ACME provider (Let's Encrypt)
  await client.createAccount({
    termsOfServiceAgreed: true,
    contact: [`mailto:${letsencryptEmail}`]
  });

  // Create CSR (Certificate Signing Request)
  const [key, csr] = await acme.crypto.createCsr({
    commonName: domain,
    altNames: [domain]
  });

  await fs.writeFile(privateKeyPath, key);

  // Request the certificate
  const certificate = await client.auto({
    csr,
    email: letsencryptEmail,
    termsOfServiceAgreed: true,
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      const challengePath = `/.well-known/acme-challenge/${challenge.token}`;
      
      console.log('Waiting for request for challenge at path ', challengePath);
      app.get(challengePath, (req, res) => {
        console.log('Challenge requested at path ', challengePath);
        res.send(keyAuthorization);
      });
    },
    challengeRemoveFn: async (authz, challenge) => {
      app._router.stack = app._router.stack.filter(
        (r) => !(r.route && r.route.path === `/.well-known/acme-challenge/${challenge.token}`)
      );
    },
    challengePriority: ['http-01'],
  });

  // Save certificate and full chain to files
  await fs.writeFile(certPath, certificate);
  // await fs.writeFile(fullchainPath, `${certificate}\n${key}`);

  console.log(`New certificate for ${domain} created and saved.`);
  return { key, cert: certificate/**, fullchain: `${certificate}\n???`*/ };
}

// Start the HTTPS server with support for multiple domains
async function startHTTPSServer(app, port, domains, letsencryptEmail) {
  try {
    // Load certificates for each domain and create a secure context for each
    const secureContexts = {};
    for (const domain of domains) {
      const { key, cert } = await getOrRenewCertificate(app, domain, letsencryptEmail);
      secureContexts[domain] = tls.createSecureContext({ key, cert });
    }

    // Create an HTTPS server with SNI (Server Name Indication) support
    const server = https.createServer(
      {
        SNICallback: (domain, callback) => {
          const context = secureContexts[domain];
          if (context) {
            callback(null, context);
          } else {
            callback(new Error(`No SSL certificate found for domain ${domain}`));
          }
        }
      },
      app
    );

    server.listen(port, () => {
      console.log('HTTPS Server running on port ' + port);
    });

    // Schedule a certificate renewal check for each domain every day
    setInterval(async () => {
      for (const domain of domains) {
        console.log(`Checking certificate renewal for ${domain}...`);
        try {
          const { cert: newCert, key: newKey } = await getOrRenewCertificate(app, domain, letsencryptEmail);
          secureContexts[domain] = tls.createSecureContext({ key: newKey, cert: newCert });
          console.log(`Certificate renewal for ${domain} checked`);
        } catch (err) {
          console.error(`Error during certificate renewal check for ${domain}:`, err);
        }
      }
    }, 24 * 60 * 60 * 1000); // Check every 24 hours

  } catch (err) {
    console.error('Failed to start HTTPS server:', err);
  }
}

export { startHTTPSServer };
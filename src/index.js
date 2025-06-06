#!/usr/bin/env node

import { Command, Option as CommanderOption, InvalidArgumentError as CommanderInvalidArgumentError } from 'commander';
import { createRequire } from "module";
import { Client as Web3Client } from 'web3protocol';
import { getDefaultChainList } from 'web3protocol/chains';
import express from 'express'
import winston from 'winston'

import { patchHTMLFile } from './patch.js';
import { setPageCache, getPageCache, hasPageCache, deletePageCache } from './page-cache.js';
import { startHTTPSServer } from './letsencrypt.js';
import { convertWeb3UrlToGatewayUrl } from './utils.js';


// Get the package.json file
// import pkg from '../package.json' with { type: 'json' };
// Using the below method to avoid the ExperimentalWarning console message with the above method
const pkg = createRequire(import.meta.url)("../package.json");


const program = new Command();

program
  .name('web3protocol-http-gateway')
  .description('A HTTPS gateway for your ERC-4804/6860 web3:// website')
  .version(pkg.version);

program
  .argument('<web3-website-address[=DNS-domain]...>', 
    `web3:// website to be served by the gateway, with an optional DNS domain. DNS domains are required if serving multiple web3:// websites, or if using SSL certificate generation. Examples:
web3://0x4e1f41613c9084fdb9e34e11fae9412427480e56
web3://0x10fE786Dc7Cb9527197C24c53d7330D3db329524:11155111
web3://mydomain.eth
web3://0x4e1f41613c9084fdb9e34e11fae9412427480e56=mywebsite.com`)
  .addOption(
    new CommanderOption(
      '-p, --port <number>', 
      'Port number')
      .env('PORT')
      .default(8080)
      .argParser(val => {
        const parsedValue = parseInt(val, 10);
        if (isNaN(parsedValue)) {
          throw new CommanderInvalidArgumentError('Not a number.');
        }
        if (parsedValue < 0 || parsedValue > 65535) {
          throw new CommanderInvalidArgumentError('Port number out of range.');
        }
        return parsedValue;
      }))
  .addOption(
    new CommanderOption(
      '-g, --global-web3-http-gateway-dns-domain <DNS-domain>', 
      'The DNS domain of the web3:// HTTP gateway to use for all web3:// calls that are not handled by this gateway')
      .env('GLOBAL_WEB3_HTTP_GATEWAY_DNS_DOMAIN')
      .default('web3gateway.dev')
      .argParser(val => {
        // Ensure this is a valid domain name
        if (!val.match(/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*(\.[a-z]{2,20})?$/)) {
          throw new CommanderInvalidArgumentError('Invalid domain name.');
        }
        return val;
      }))
  .addOption(
    new CommanderOption(
      '--lets-encrypt-enable-https', 
      'Enable HTTPS with Let\'s Encrypt SSL certificates')
      .default(false)
      .env('LETSENCRYPT_ENABLE_HTTPS'))
  .addOption(
    new CommanderOption(
      '--lets-encrypt-email <email>', 
      'Email for the Let\'s Encrypt SSL certificate generation')
      .env('LETSENCRYPT_EMAIL')
      .default('')
      .argParser(val => {
        // Ensure the email is valid
        if (!val.match(/^.+@.+\..+$/)) {
          throw new CommanderInvalidArgumentError('Invalid email address.');
        }
        return val;
      }))
  .addOption(
    new CommanderOption(
      '--force-cache', 
      'All web3:// calls will be cached indefinitely even if the website does not ask for it. Used to avoid RPC calls; only do this if you are aware of the consequences.')
      .default(false)
      .env('FORCE_CACHE'))
  .addOption(
    new CommanderOption(
      '-c, --chain-rpc <chain-id=rpc-provider-url>', 
      `Add/override a chain RPC. Can be used multiple time. Examples:
1=https://eth-mainnet.alchemyapi.io/v2/<your_api_key> : override the RPC for chain id 1 (Ethereum mainnet)
123456789=http://127.0.0.1:8545 : Set the RPC for non-existing chain id 123456789`)
      .env('CHAIN_RPC')
      .default([])
      .argParser((val, previousVal) => {
        // If val is multiple values (can happen if used via the CHAIN_RPC env variable), split them
        let vals = val.split(' ').filter(v => v.trim() !== '');
        
        // Process them
        vals = vals.map(v => {
          const [chainId, rpcUrl] = v.split('=');
          if(!chainId || !rpcUrl) {
            throw new CommanderInvalidArgumentError('Invalid chain RPC definition : ' + v);
          }

          const parsedChainId = parseInt(chainId, 10);
          if(isNaN(parsedChainId) || parsedChainId < 0) {
            throw new CommanderInvalidArgumentError('Invalid chain ID : ' + chainId);
          }

          if(!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
            throw new CommanderInvalidArgumentError('Invalid RPC URL (must start with http:// or https://) : ' + rpcUrl);
          }

          return {
            chainId: parsedChainId,
            rpcUrl
          }
        })

        // Merge with previous values
        if(previousVal) {
          vals = [...previousVal, ...vals];
        }

        return vals
      }))
  
program.parse(process.argv);
const args = program.args;
const options = program.opts();


// Parse the args: The list of served web3:// websites
const servedWeb3Websites = args.map(arg => {
  const [web3Url, dnsDomain] = arg.split('=');

  if(!web3Url.startsWith('web3://')) {
    console.log('Error: Invalid web3:// URL : ' + web3Url + ' (must start with web3://)');
    process.exit(1);
  }

  // Parse the web3Url, extract the hostname and port parth
  const web3UrlMatchResult = web3Url.match(/^web3:\/\/(?<hostname>[^:\/?#]+)(:(?<chainId>[1-9][0-9]*))?(?<path>[^#]*)?(#(?<fragment>.*)?)?$/)
  if(!web3UrlMatchResult) {
    console.log('Error: Invalid web3:// URL : ' + web3Url);
    process.exit(1);
  }
  const web3UrlMainParts = web3UrlMatchResult.groups

  // Ensure there is no path (or only "/")
  if(web3UrlMainParts.path && web3UrlMainParts.path !== '/' && web3UrlMainParts.path !== '') {
    console.log('Error: Invalid web3:// URL : ' + web3Url + ' : Cannot serve a specific path only.');
    process.exit(1);
  }
  // Ensure no fragment
  if(web3UrlMainParts.fragment) {
    console.log('Error: Invalid web3:// URL : ' + web3Url + ' : Fragment not allowed');
    process.exit(1);
  }

  // DnsDomain (optional) : ensure it is a correct DNS domain
  if(dnsDomain && !dnsDomain.match(/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*(\.[a-z]{2,20})?$/)) {
    console.log('Error: Invalid DNS domain : ' + dnsDomain);
    process.exit(1);
  }

  return {
    web3UrlHostname: web3UrlMainParts.hostname,
    web3UrlChain: web3UrlMainParts.chainId ? parseInt(web3UrlMainParts.chainId, 10) : 1,
    baseWeb3Url: "web3://" + web3UrlMainParts.hostname + (web3UrlMainParts.chainId ? ':' + web3UrlMainParts.chainId : ''),
    dnsDomain: dnsDomain ?? null
  }
});

// If there are more than 1 served websites, ensure they all have a DNS domain
if(servedWeb3Websites.length > 1 && servedWeb3Websites.filter(website => !website.dnsDomain).length > 0) {
  console.log('Error: When serving multiple web3:// websites, they must all have a DNS domain');
  process.exit(1);
}

// If letsEncryptEnableHttps is true, ensure the email is set
if(options.letsEncryptEnableHttps && !options.letsEncryptEmail) {
  console.log('Error: The email must be set when enabling HTTPS with Let\'s Encrypt');
  process.exit(1);
}

// If letsEncryptEnableHttps is true, ensure all served websites have a DNS domain
if(options.letsEncryptEnableHttps && servedWeb3Websites.filter(website => !website.dnsDomain).length > 0) {
  console.log('Error: When enabling HTTPS with Let\'s Encrypt, all served web3:// websites must have a DNS domain');
  process.exit(1);
}


// Printing the list of served websites
console.log('Serving the following web3:// websites:');
servedWeb3Websites.forEach(website => {
  console.log(' - ' + (website.dnsDomain ? website.dnsDomain + ' => ' : '') + website.baseWeb3Url);
});
console.log("");


//
// Prepare the Express app
//

// Prepare the logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }), // Customize timestamp format
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()} ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
  ],
});


// Prepare the web3 client
// Prepare the chain list, include the overrides
const chainList = getDefaultChainList()

// Overrides: Group by chain id
let chainOverrides = []
options.chainRpc.map(chainRPC => {
  // Find if chain is already overriden
  let alreadyDefinedChainOverride = Object.entries(chainOverrides).find(chainOverride => chainOverride[1].id == chainRPC.chainId) || null

  // If already exist, add the RPC to the list
  if(alreadyDefinedChainOverride) {
    chainOverrides[alreadyDefinedChainOverride[0]].rpcUrls.push(chainRPC.rpcUrl)
  }
  // If does not exist, create it
  else {
    let chainOverride = {
      id: chainRPC.chainId,
      rpcUrls: [chainRPC.rpcUrl]
    }
    chainOverrides.push(chainOverride)
  }
})

// Add the overrides on the main chain list
chainOverrides.map(chainOverride => {
  // Find if the chain already exist
  let alreadyDefinedChain = Object.entries(chainList).find(chain => chain[1].id == chainOverride.id) || null

  // If it exists, override RPCs
  if(alreadyDefinedChain) {
    chainList[alreadyDefinedChain[0]].rpcUrls = [...chainOverride.rpcUrls]
  }
  // If does not exist, create it
  else {
    let newChain = {
      id: chainOverride.id,
      name: 'custom-' + chainOverride.id,
      rpcUrls: [...chainOverride.rpcUrls],
    }
    chainList.push(newChain)
  }
})

// Create the Web3 client
const web3Client = new Web3Client(chainList)


// Prepare the express app
const app = express()
// All paths but the .well-known/* ones (for SSL certs challenges)
app.get(/^((?!^\/\.well-known\/).)*$/, async (req, res) => {
  // If HTTPS is enabled, and this is HTTP, redirect to HTTPS
  if(options.letsEncryptEnableHttps && req.protocol === 'http') {
    res.redirect('https://' + req.hostname + req.originalUrl);
    return;
  }

  // Find the served web3:// website
  // - If there is more than 1 served website, or there is only one, but configured with a DNS domain, 
  //   find the one matching the DNS domain
  // - Otherwise, use the only one inconditionally
  const servedWeb3Website = servedWeb3Websites.length > 1 || servedWeb3Websites[0].dnsDomain ? 
    servedWeb3Websites.find(website => website.dnsDomain === req.hostname) : 
    servedWeb3Websites[0];
  if (!servedWeb3Website) {
    res.status(503).send('No web3:// website found for this domain : ' + req.hostname);
    logger.info(req.hostname + ' ' + req.path + ' 503')
    return
  }

  // Create the matching web3:// URL
  const web3Url = servedWeb3Website.baseWeb3Url + req.path

  // If the forceCache option is on: If the page is in cache, return the cache
  if(options.forceCache) {
    if(hasPageCache(web3Url)) {
      const pageCache = getPageCache(web3Url);
      res.status(pageCache.httpCode)
      Object.entries(pageCache.httpHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      res.write(pageCache.output);
      res.end();
      logger.info(req.hostname + ' ' + req.path + ' 200 (from cache)')
      return
    }
  }

  // Make the call to the web3:// website
  try {
    const fetchedWeb3Url = await web3Client.fetchUrl(web3Url)

    // Set the HTTP Code
    res.status(fetchedWeb3Url.httpCode);

    // Set the response headers
    Object.entries(fetchedWeb3Url.httpHeaders).forEach(([key, value]) => {
      // If header is "Location", and value is a web3:// URL, convert it to a gateway URL
      if(key.toLowerCase() === 'location' && value.startsWith('web3://')) {
        try {
          value = convertWeb3UrlToGatewayUrl(value, req.get('host'), options.letsEncryptEnableHttps, servedWeb3Websites, options.globalWeb3HttpGatewayDnsDomain);
        } catch (err) {
          // If we cannot convert the URL, we just leave it as is
        }
      }
      res.setHeader(key, value);
    });

    // Determine the content type of the response
    const contentType = Object.entries(fetchedWeb3Url.httpHeaders).find(([key, value]) => key.toLowerCase() === 'content-type')?.[1];

    // Determine the content encoding of the response
    const contentEncoding = Object.entries(fetchedWeb3Url.httpHeaders).find(([key, value]) => key.toLowerCase() === 'content-encoding')?.[1];

    // Send the response body
    const reader = fetchedWeb3Url.output.getReader();
    let chunkNumber = 0;
    let body = Uint8Array.of(); // Will be filled if we want to cache it
    while (true) {
      let { done, value } = await reader.read();

      // We got a chunk
      if(value) {
        // First chunk: If the content type is text/html, we inject some javascript which 
        // handle conversion of web3:// URLs to http:// gateway URLs
        if(chunkNumber == 0 && contentType && contentType.toLowerCase().startsWith('text/html')) {
          value = await patchHTMLFile(value, contentEncoding, req.get('host'), options.letsEncryptEnableHttps, servedWeb3Websites, options.globalWeb3HttpGatewayDnsDomain)
        }

        // Write the chunk to the response
        res.write(value);

        // If the forceCache option is on, we fill the body buffer, to save it later
        if(options.forceCache) {
          let newBody = new Uint8Array(body.length + value.length);
          newBody.set(body);
          newBody.set(value, body.length);
          body = newBody;
        }

        chunkNumber++;
      }

      // When no more data needs to be consumed, break the reading
      if (done) {
        break;
      }
    }

    // If the forceCache option is on, save the body in cache
    if(options.forceCache) {
      setPageCache(web3Url, {
        httpCode: fetchedWeb3Url.httpCode,
        httpHeaders: fetchedWeb3Url.httpHeaders,
        output: body
      })
    }

    res.end();

    logger.info(req.hostname + ' ' + req.path + ' ' + fetchedWeb3Url.httpCode)

  // Handle errors
  } catch (error) {
    res.status(503).send('Error fetching the web3:// website: ' + error.message);
    logger.info(req.hostname + ' ' + req.path + ' 503')
    return
  }
})

// HTTP server
app.listen(options.port, () => {
  console.log('HTTP Server running on port ' + options.port);
});

// HTTPS server
if(options.letsEncryptEnableHttps) {
  // Get the list of domains to serve
  const domains = servedWeb3Websites.map(website => website.dnsDomain);

  startHTTPSServer(app, 443, domains, options.letsEncryptEmail)
}
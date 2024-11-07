import { promises as fs } from 'fs';
import path from 'path';

// If the content type is text/html, we do some processing on the data, to basically
// replace all web3:// URLs into gateway http:// URLs.
// This is not 100% perfect:
// - This will fail if the content is compressed and spread over several chunks (should be rare)
async function patchHTMLFile(buf, contentEncoding, servedWeb3Websites, globalWeb3HttpGatewayDnsDomain) {
	let alteredBuf = new Uint8Array(buf);

	// If contentEncoding is "gzip", then first decompress the data
	if (contentEncoding === "gzip") {
		try {
			const decompressed = await decompressGzip(alteredBuf);
			alteredBuf = new Uint8Array(decompressed);
		} catch (err) {
			console.log(`patchHtmlFile: Cannot initiate gzip decompression: ${err}`);
			return buf;
		}
	}

	// Convert Uint8Array to string for manipulation
	let alteredStr = new TextDecoder().decode(alteredBuf);

	// Look for the "<body>" tag, and insert the patch right after it
	const bodyTagIndex = alteredStr.indexOf("<body>");
	if (bodyTagIndex === -1) {
		return buf;
	}

  // There are 2 parts in the patch: The first one where we declare some javascript variables, and
  // the second part being some JS code stored in html.patch.
  const gatewayWeb3Websites = servedWeb3Websites.map(website => {
    return {
      web3HostnameAndChain: website.web3UrlHostname + (website.web3UrlChain > 1 ? `:${website.web3UrlChain}` : ''),
      dnsDomain: website.dnsDomain
    };
  });

  const htmlPatchVars = `
  <script>
    /** 
     * Patch by web3protocol-http-gateway-js, part 1/2 : Inject some configuration variables for the patch in part 2/2.
     */
    var gatewayWeb3Websites = ${JSON.stringify(gatewayWeb3Websites)};
    var globalWeb3HttpGatewayDnsDomain = ${JSON.stringify(globalWeb3HttpGatewayDnsDomain)};
  </script>
  `;

	// Insert the patch right after the "<body>" tag
	const htmlPatch = htmlPatchVars + await fetchHtmlPatch();
	alteredStr = alteredStr.slice(0, bodyTagIndex + "<body>".length) + htmlPatch + alteredStr.slice(bodyTagIndex + "<body>".length);

	// Convert string back to Uint8Array
	alteredBuf = new TextEncoder().encode(alteredStr);

	// If contentEncoding is "gzip", then recompress the data
	if (contentEncoding === "gzip") {
		try {
			const compressed = await compressGzip(alteredBuf);
			alteredBuf = new Uint8Array(compressed);
		} catch (err) {
			console.log(`patchHtmlFile: Cannot recompress gzip data: ${err}`);
			return buf;
		}
	}

	return alteredBuf;
}

async function decompressGzip(data) {
	const ds = new DecompressionStream('gzip');
	const decompressedStream = new Response(data).body.pipeThrough(ds);
	const decompressedArrayBuffer = await new Response(decompressedStream).arrayBuffer();
	return new Uint8Array(decompressedArrayBuffer);
}

async function compressGzip(data) {
	const cs = new CompressionStream('gzip');
	const compressedStream = new Response(data).body.pipeThrough(cs);
	const compressedArrayBuffer = await new Response(compressedStream).arrayBuffer();
	return new Uint8Array(compressedArrayBuffer);
}

async function fetchHtmlPatch() {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const patchFilePath = path.join(__dirname, 'html.patch');
  const htmlPatch = await fs.readFile(patchFilePath, 'utf8');
  return htmlPatch;
}

export { patchHTMLFile };
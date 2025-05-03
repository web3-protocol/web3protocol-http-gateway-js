import { promises as fs } from 'fs';
import path from 'path';
import { convertWeb3UrlToGatewayUrl } from './utils.js';

// If the content type is text/html, we do some processing on the data, to basically
// replace all web3:// URLs into gateway http:// URLs.
// This is not 100% perfect:
// - This will fail if the content is compressed and spread over several chunks (should be rare)
async function patchHTMLFile(buf, contentEncoding, requestHost, serverIsHttps, servedWeb3Websites, globalWeb3HttpGatewayDnsDomain) {
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


	// In the HTML itself, convert web3:// URLs to gateway URLs
	// Map of HTML tags to their attributes that could contain web3:// URLs
	const elementWithAttributes = {
		"a": "href",
		"link": "href",
		"area": "href",
		"img": "src",
		"script": "src",
		"iframe": "src",
		"video": "src",
		"audio": "src",
		"source": "src",
		"embed": "src",
		"input": "src",
		"object": "data",
	};

	// Lookup each tag in the HTML document, process their attributes
	const htmlTagRegex = /<\s*([a-z0-9]+)([^>]*)>/gi;
	let match;
	let processedHTML = alteredStr;
	while ((match = htmlTagRegex.exec(alteredStr)) !== null) {
		const tagName = match[1].toLowerCase();
		let tagAttributes = match[2];
		const originalTag = match[0];
		
		// Check if the tag is in the map of tags to process
		const attributeName = elementWithAttributes[tagName];
		if (attributeName) {
			// Find the attribute in the tag attributes
			const attributeRegex = new RegExp(`${attributeName}\\s*=\\s*["']?([^"'>\\s]+)["']?`, 'i');
			const attributeMatch = tagAttributes.match(attributeRegex);
			
			if (attributeMatch && attributeMatch[1]) {
				const attributeValue = attributeMatch[1];
				
				// Check if the attribute value is a web3:// URL
				if (attributeValue.startsWith('web3://')) {
					// Convert the web3:// URL to a gateway URL
					try {
						const newUrl = convertWeb3UrlToGatewayUrl(attributeValue, requestHost, serverIsHttps, servedWeb3Websites, globalWeb3HttpGatewayDnsDomain);
						
						// Replace the attribute value in the tag attributes
						const newTagAttributes = tagAttributes.replace(attributeValue, newUrl);
						
						// Update the tag in the HTML content
						const newTag = `<${tagName}${newTagAttributes}>`;
						processedHTML = processedHTML.replace(originalTag, newTag);
					}
					catch (err) {
						// If we cannot convert the URL, we just leave it as is
					}
				}
			}
		}
	}
	alteredStr = processedHTML;


	// Look for the "<body>" tag, which might have attributes
	const bodyTagRegex = /<body[^>]*>/i;
	const bodyTagMatch = alteredStr.match(bodyTagRegex);
	if (bodyTagMatch && bodyTagMatch.index !== undefined) {
		const bodyTagIndex = bodyTagMatch.index;
		const bodyTagComplete = bodyTagMatch[0];

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
		alteredStr = alteredStr.slice(0, bodyTagIndex + bodyTagComplete.length) +
			htmlPatch +
			alteredStr.slice(bodyTagIndex + bodyTagComplete.length);
	}


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
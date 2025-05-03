// Function to convert web3:// URL to gateway URL
// @param web3Url - The web3:// URL to convert
// @param requestHost - The host of the current request (can include port)
// @param serverIsHttps - Boolean indicating if the server is using HTTPS
// @param servedWeb3Websites - Array of objects containing web3 URL hostnames and chain IDs
// @param globalWeb3HttpGatewayDnsDomain - The global DNS domain for the web3 HTTP gateway
function convertWeb3UrlToGatewayUrl(web3Url, requestHost, serverIsHttps, servedWeb3Websites, globalWeb3HttpGatewayDnsDomain) {
	// Parse the URL
	const re = /^(?<protocol>[^:]+):\/\/(?<hostname>[^:\/?#]+)(:(?<chainId>[1-9][0-9]*))?(?<pathQuery>(?<path>\/[^?#]*)?([?](?<query>[^#]*))?)?(#(?<fragment>.*))?$/;
	const match = web3Url.match(re);
	
	if (!match || !match.groups) {
		// Invalid web3:// URL
    throw new Error(`Invalid web3 URL: ${web3Url}`);
	}
	
	const urlMainParts = match.groups;
	
	// Check protocol name
	const webProtocol = urlMainParts.protocol;
	if (webProtocol !== 'web3' && webProtocol !== 'w3') {
		// Bad protocol name
    throw new Error(`Invalid web3 URL protocol: ${webProtocol}`);
	}
	
	// Search if the hostname+chainId is in the list of web3 addresses handled by this gateway
	const gatewayWeb3Websites = servedWeb3Websites.map(website => {
		return {
			web3HostnameAndChain: website.web3UrlHostname + (website.web3UrlChain > 1 ? `:${website.web3UrlChain}` : ''),
			dnsDomain: website.dnsDomain
		};
	});
	const gatewayWeb3Website = gatewayWeb3Websites.find(function(gatewayWeb3Website) {
		return gatewayWeb3Website.web3HostnameAndChain.toLowerCase() === urlMainParts.hostname.toLowerCase() + (urlMainParts.chainId ? ':' + urlMainParts.chainId : '');
	});
	// If we found one, build and return the URL
	if(gatewayWeb3Website) {
		// Explode requestHost into hostname and port
		const requestHostParts = requestHost.split(':');
		const requestHostHostname = requestHostParts[0];
		const requestHostPort = requestHostParts[1];
		// If there is no DNS domain configured, use the current one
		const gateway = (gatewayWeb3Website.dnsDomain ? gatewayWeb3Website.dnsDomain : requestHostHostname) + (requestHostPort ? ':' + requestHostPort : '');
		const gatewayUrl = (serverIsHttps ? 'https:' : 'http:') + "//" + gateway + (urlMainParts.path ?? "");
		return gatewayUrl;
	}

	// If this web3 address is not handled by this gateway, use the global one, if we have one configured
	if(!globalWeb3HttpGatewayDnsDomain) {
		throw new Error(`No global web3 HTTP gateway DNS domain configured and the web3 URL is not handled by this gateway: ${web3Url}`);
	}

	// Get subdomain components
	let gateway = globalWeb3HttpGatewayDnsDomain;
	const subDomains = [];
	
	// Is the contract an ethereum address?
	const isEthAddress = /^0x[0-9a-fA-F]{40}$/.test(urlMainParts.hostname);
	
	if (isEthAddress) {
		subDomains.push(urlMainParts.hostname);
		
		if (urlMainParts.chainId) {
			subDomains.push(urlMainParts.chainId);
		} else {
			subDomains.push('1');
		}
	} else {
		// It is a domain name
		if (urlMainParts.hostname.endsWith('.eth') && !urlMainParts.chainId) {
			subDomains.push(urlMainParts.hostname);
			subDomains.push('1');
		} else {
			subDomains.push(urlMainParts.hostname);
			
			if (urlMainParts.chainId) {
				subDomains.push(urlMainParts.chainId);
			}
		}
	}
	
	let path = urlMainParts.path || '/';
	let query = urlMainParts.query ? `?${urlMainParts.query}` : '';
	let fragment = urlMainParts.fragment ? `#${urlMainParts.fragment}` : '';
	
	const protocol = 'http';
	if (serverIsHttps) {
		protocol = 'https';
	}
	
	const gatewayUrl = `${protocol}://${subDomains.join('.')}.${gateway}${path}${query}${fragment}`;
	return gatewayUrl;
}


export { convertWeb3UrlToGatewayUrl };
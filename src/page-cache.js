const cache = new Map();

function setPageCache(web3Url, value) {
  cache.set(web3Url, value);
}

function getPageCache(web3Url) {
  return cache.get(web3Url);
}

function hasPageCache(web3Url) {
  return cache.has(web3Url);
}

function deletePageCache(web3Url) {
  return cache.delete(web3Url);
}

export { setPageCache, getPageCache, hasPageCache, deletePageCache };

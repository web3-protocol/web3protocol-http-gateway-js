# web3protocol-http-gateway

[![npm version](https://badge.fury.io/js/web3protocol-http-gateway.svg)](https://www.npmjs.com/package/web3curl)

A HTTP gateway server for your [ERC-6860/4804 `web3://`](https://web3url.io/) website(s).

## Usage

```bash
web3protocol-http-gateway <your web3:// website>
```

Example:

```bash
web3protocol-http-gateway web3://0xAD41bf1c7f22F0ec988DaC4C0aE79119Cab9BB7E
```

will serve the `web3://0xAD41bf1c7f22F0ec988DaC4C0aE79119Cab9BB7E` website at `http://localhost:8080`

## Installation

#### Transparent installation

```bash
npx web3protocol-http-gateway web3://0xAD41bf1c7f22F0ec988DaC4C0aE79119Cab9BB7E
```

#### Global installation

```bash
npm install -g web3protocol-http-gateway
web3protocol-http-gateway web3://0xAD41bf1c7f22F0ec988DaC4C0aE79119Cab9BB7E
```

#### With docker

```bash
docker compose up
```

The `docker-compose.yml` file contains documentation on how to configure it.

## Options 

### Serve multiple websites

You can serve multiple `web3://` websites. In this case, a DNS domain is required for each. Example : 

```bash
web3protocol-http-gateway web3://0xAD41bf1c7f22F0ec988DaC4C0aE79119Cab9BB7E=terraformnavitagor.com web3://ocweb.eth=ocweb.com
```

If you then configure `ocweb.com` and `terraformnavigator.com` to point to your server, they will deliver their respective `web3://` website.

### Override chain RPCs

By default, public RPCs provided by the `web3protocol-js` library are used. If you wish to override a RPC with a paid one, or with a local node for testing, you can do it by using the `-c, --chain-rpc` option. Example :

```bash
web3protocol-http-gateway -c 1=https://eth-mainnet.alchemyapi.io/v2/XXX -c 123456789=http://127.0.0.1:8545 web3://0xAD41bf1c7f22F0ec988DaC4C0aE79119Cab9BB7E
```

This will override the Ethereum mainnet RPC with the `https://eth-mainnet.alchemyapi.io/v2/XXX` RPC, and set `http://127.0.0.1:8545` as RPC of the non-existant chain with id `123456789`.

### Force caching

If you have heavy traffic, and you know your website is static, and you want to avoid RPC calls for which you may be billed, you can use the `--force-cache` option, which will cache indefinitely the called URLs.

If you are a website developer: Note that the use of the proposed [ERC-7774](https://github.com/ethereum/ERCs/pull/652) will allow you to make websites that can be cached by the `web3://` protocol.

### Global web3:// HTTP gateway fallback

Your website(s) may point to an URL which is not served by your HTTP gateway. In this case, the global web3:// HTTP gateway is used. By default it is `web3gateway.dev`, and can be configured with the `-g, --global-web3-http-gateway-dns-domain` option.

### Port

By default, the gateway listen to the `8080` port. If you wish to change it, you can use the `-p, --port <number>` option.

## Page content patching by the gateway

HTML pages may have absolute `web3://` links to resources (in `<a>`, `<script>`, `<img>`, ... tags), which your browser will not process. 

In order to fix that, some javascript code is injected into served HTML pages, that will transform `web3://` URLs into their gateway `http://` equivalent.


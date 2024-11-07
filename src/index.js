import { Command, Option as CommanderOption } from 'commander';

// import pkg from '../package.json' with { type: 'json' };
// Using the below method to avoid the ExperimentalWarning console message with the above method
import { createRequire } from "module";
const pkg = createRequire(import.meta.url)("../package.json");


const program = new Command();

program
  .name('web3protocol-http-gateway')
  .description('A HTTPS gateway for your ERC-4804/6860 web3:// website')
  .version(pkg.version);

program
  .argument('<web3:// website address[=DNS domain]...>', 'web3:// website to be served by the gateway, with an optional DNS domain. DNS domains are required if serving multiple web3:// websites, or if using SSL certificate generation. Examples:\nweb3://0x4e1f41613c9084fdb9e34e11fae9412427480e56\nweb3://0x10fE786Dc7Cb9527197C24c53d7330D3db329524:11155111\nweb3://mydomain.eth\nweb3://0x4e1f41613c9084fdb9e34e11fae9412427480e56=mywebsite.com')
  .addOption(new CommanderOption('-p, --port <number>', 'Port number').env('PORT').default(8080))
  .addOption(new CommanderOption('--lets-encrypt-enable-https', 'Enable HTTPS with Let\'s Encrypt SSL certificates').env('LETSENCRYPT_ENABLE_HTTPS'))
  .addOption(new CommanderOption('--lets-encrypt-email <email>', 'Email for the Let\'s Encrypt SSL certificate generation').env('LETSENCRYPT_EMAIL'))
  .addOption(new CommanderOption('--force-cache', 'All web3:// calls will be cached aggressively even if the website does not ask for it. Used to avoid RPC calls; only do this if you are aware of the consequences.').env('FORCE_CACHE'))
  .addOption(new CommanderOption('-c, --chain-rpc <chain-id=rpc-provider-url...>', 'Add/override a chain RPC. Examples:\n1=https://eth-mainnet.alchemyapi.io/v2/<your_api_key> : override the RPC for chain id 1 (Ethereum mainnet)\n123456789=http://127.0.0.1:8545 : Set the RPC for non-existing chain id 123456789').env('CHAIN_RPC'))
  
  

  

program.parse(process.argv);

const args = program.args;
console.log(args);

const options = program.opts();
console.log(options);
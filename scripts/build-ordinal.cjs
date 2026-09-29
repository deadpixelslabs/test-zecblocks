'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const solc=require('solc');
const {keccak256}=require('ethers');
const root=path.resolve(__dirname,'..');
function compile(){
  if(!solc.version().startsWith('0.8.26+'))throw new Error('Use solc 0.8.26.');
  const sources={};
  function add(name){
    if(sources[name])return;
    const filename=name.startsWith('@openzeppelin/contracts/')?path.join(root,'vendor/openzeppelin',name.slice(24)):path.join(root,'contracts/ordinal',name);
    const content=fs.readFileSync(filename,'utf8');sources[name]={content};
    for(const match of content.matchAll(/import\s+(?:[^;]*?from\s+)?["']([^"']+)["']\s*;/g)){
      const target=match[1].startsWith('@')?match[1]:path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));
      add(target);
    }
  }
  add('RobinhoodOrdinal.sol');
  const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','storageLayout']}}}};
  const out=JSON.parse(solc.compile(JSON.stringify(input)));
  for(const e of out.errors||[])if(e.severity==='error')throw new Error(e.formattedMessage);
  const contracts={};
  for(const name of ['RobinhoodOrdinal','RobinhoodOrdinalRenderer']){
    const c=out.contracts[name+'.sol'][name];
    const runtime=c.evm.deployedBytecode.object.length/2,init=c.evm.bytecode.object.length/2;
    if(runtime>24576||init>49152)throw new Error(name+' exceeds EVM deployment size limit.');
    contracts[name]={contractName:name,compiler:solc.version(),chainId:4663,sourceSha256:crypto.createHash('sha256').update(sources[name+'.sol'].content).digest('hex'),abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object,runtimeCodeHash:keccak256('0x'+c.evm.deployedBytecode.object),runtimeBytes:runtime,initBytes:init,storageLayout:c.storageLayout};
  }
  return {input,contracts};
}
if(require.main===module){
  const {input,contracts}=compile(),check=process.argv.includes('--check');
  const files={'compiler-input.json':input,...Object.fromEntries(Object.entries(contracts).map(([k,v])=>[k+'.json',v]))};
  for(const [name,obj] of Object.entries(files)){
    const file=path.join(root,'ordinal',name),text=JSON.stringify(obj,null,2)+'\n';
    if(check){if(fs.readFileSync(file,'utf8')!==text)throw new Error('Reproducible build differs: '+name);}
    else fs.writeFileSync(file,text);
  }
  console.log(JSON.stringify({checked:check,contracts:Object.fromEntries(Object.entries(contracts).map(([k,v])=>[k,{runtimeBytes:v.runtimeBytes,initBytes:v.initBytes,runtimeCodeHash:v.runtimeCodeHash}]))}));
}
module.exports={compile};

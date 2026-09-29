'use strict';
const {ContractFactory,Contract}=require('ethers');
const {startChain:baseChain}=require('./rh20-chain.cjs');
const artifact=require('../../ordinal/RobinhoodOrdinal.json');
const rendererArtifact=require('../../ordinal/RobinhoodOrdinalRenderer.json');
async function startChain(){
  const chain=await baseChain();
  try{
    const core=await new ContractFactory(artifact.abi,artifact.bytecode,chain.signers[0]).deploy();
    const receipt=await core.deploymentTransaction().wait();
    const rendererAddress=await core.renderer();
    const renderer=new Contract(rendererAddress,rendererArtifact.abi,chain.provider);
    return {...chain,core,receipt,artifact,renderer,rendererArtifact};
  }catch(e){await chain.close();throw e;}
}
module.exports={startChain};

// The exact-check endpoint has already verified this intent's wallet signature.
// Verify its work against the canonical source before making a non-expiring hold.
const GENESIS='ecf6fc3a79885f573d79de70a2de85c34667fc1a4fefe034d3a4015269379f0f';
function bytes(s:string){if(!/^[0-9a-f]{64}$/.test(s))throw new Error('Invalid proof field');return Uint8Array.from(s.match(/../g)!.map(x=>parseInt(x,16)))}
export async function verifyCapacityProof(intent:any,owner:string){
  const token=Number(intent?.tokenId),nonce=String(intent?.nonce??'');
  if(!Number.isInteger(token)||token<1||token>5000||!/^[0-9]{1,20}$/.test(nonce)||BigInt(nonce)>0xffffffffffffffffn||intent?.ownerCommitment!==owner)throw new Error('Invalid claim intent');
  const height=3488573-token;
  const r=await fetch('https://api.mainnet.cipherscan.app/api/block/'+height,{headers:{accept:'application/json'},signal:AbortSignal.timeout(6500)});
  if(!r.ok)throw new Error('Source block verification unavailable. Retry before sending a claim.');
  const block=await r.json(),source=String(block?.hash||block?.block_hash||block?.blockHash||'').toLowerCase();
  if(source!==String(intent.sourceHash).toLowerCase()||Number(intent.sourceHeight)!==height)throw new Error('Claim source block mismatch');
  const prefix=new TextEncoder().encode('ZB1:MINE:v1'),data=new Uint8Array(prefix.length+32+4+32+32+8);
  let at=0;data.set(prefix,at);at+=prefix.length;data.set(bytes(GENESIS),at);at+=32;
  new DataView(data.buffer).setUint32(at,token,true);at+=4;
  data.set(bytes(source),at);at+=32;data.set(bytes(owner),at);at+=32;
  new DataView(data.buffer).setBigUint64(at,BigInt(nonce),true);
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
  if(hash[0]!==0||hash[1]!==0||hash[2]!==0||(hash[3]&0xc0)!==0)throw new Error('Invalid claim proof');
  const hex=Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
  if(hex!==String(intent.proofHash).toLowerCase())throw new Error('Claim proof hash mismatch');
}

// Isolated PostgreSQL only. Both requests use real, separate transactions.
const {execFile,execFileSync}=require('node:child_process');
const {promisify}=require('node:util');
const assert=require('node:assert/strict');
const run=promisify(execFile),args=['-X','-v','ON_ERROR_STOP=1','-At'];
(async()=>{
 execFileSync('psql',[...args,'-c',"insert into zecblocks_claim_slots(token_id,slot_no,state) select id,id+2,'confirmed' from generate_series(1,4441) id;"]);
 const results=await Promise.all([4442,4443].map(id=>run('psql',[...args,'-c',`begin; select zecblocks_claim_admit(${id},'confirmed'); select pg_sleep(0.2); commit;`])));
 assert.equal(results.filter(r=>r.stdout.split('\n').includes('t')).length,1,'exactly one competing claimant wins final capacity');
 assert.equal(results.filter(r=>r.stdout.split('\n').includes('f')).length,1,'the other claimant is refused');
 const count=execFileSync('psql',[...args,'-c','select count(*) from zecblocks_claim_slots;'],{encoding:'utf8'}).trim();
 assert.equal(count,'4444');
 console.log('PASS: separate concurrent transactions cannot admit claim 4445');
})().catch(e=>{console.error(e);process.exitCode=1});

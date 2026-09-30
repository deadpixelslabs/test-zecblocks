(function () {
  'use strict';
  const library = window.RH20Protocol, E = window.ethers;
  let T = document.body.dataset.ticker || 'RHSC';
  let P = library.forToken(Object.hasOwn(library.catalog, T) ? T : 'RHSC');
  let AMOUNT = BigInt(P.spec.mintAmount), MAX = BigInt(P.spec.maxSupply), LIMIT = P.spec.maxMintsPerWallet;
  const $ = id => document.getElementById(id);
  const mode = document.body.dataset.mode, community = document.body.dataset.community === 'true';
  const S = { formValid: !community, communityReady: false, config: null, artifact: null, iface: null, publicReader: null, wallet: null, provider: null, account: null, chain: null, wallets: [], busy: false, refreshing: false, checking: false, generation: 0, verified: false, token: null, count: 0n, balance: 0n, pending: null, receipt: null, timer: null };
  const fmt = value => BigInt(value).toLocaleString('en-US');
  const short = value => value.slice(0, 6) + '…' + value.slice(-4);
  const deadline = (promise, ms = 12000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection delayed. Please try checking again.')), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  function status(text, kind = '') { $('status').textContent = text; $('status').className = 'status' + (kind ? ' ' + kind : ''); }
  function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 2500); }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('themeButton').textContent = theme === 'dark' ? '☀' : '☾';
    $('themeButton').setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
    try { localStorage.setItem('rh20-theme', theme); } catch (_) {}
  }
  try { setTheme(localStorage.getItem('rh20-theme') === 'light' ? 'light' : 'dark'); } catch (_) { setTheme('dark'); }
  $('themeButton').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.onclick = async () => { try { await navigator.clipboard.writeText($(button.dataset.copy).textContent); toast('Copied'); } catch (_) { toast('Copy unavailable. Select the text to copy it.'); } };
  });

  function addWallet(provider, name) {
    if (!provider || typeof provider.request !== 'function' || S.wallets.some(item => item.provider === provider)) return;
    S.wallets.push({ provider, name: String(name || 'Browser wallet').slice(0, 40) });
    const option = document.createElement('option'); option.value = String(S.wallets.length - 1); option.textContent = S.wallets.at(-1).name;
    $('walletSelect').append(option); $('walletSelect').hidden = S.wallets.length < 2;
  }
  window.addEventListener('eip6963:announceProvider', event => addWallet(event.detail?.provider, event.detail?.info?.name));
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  function legacyWallets() {
    const candidates = window.ethereum?.providers || (window.ethereum ? [window.ethereum] : []);
    for (const provider of candidates) addWallet(provider, provider.isRabby ? 'Rabby' : provider.isMetaMask ? 'MetaMask' : provider.isPhantom ? 'Phantom' : 'Browser wallet');
  }
  legacyWallets();

  function reader() { return S.provider && S.chain === P.CHAIN_ID ? S.provider : S.publicReader; }
  function journalKey(account = S.account) { if (community) return ['rh20', 4663, 'register', 'community', account.toLowerCase()].join(':'); return P.pendingKey(mode, account, mode !== 'deploy' ? S.config.contractAddress : null); }
  function transactionData() { return mode === 'deploy' ? S.artifact.bytecode : S.iface.encodeFunctionData('inscribe', [mode === 'register' ? P.DEPLOY : P.MINT]); }
  function communitySpec(values) {
    const rules = library.validateRules(values.tick, values.max, values.lim);
    const protocol = library.forToken(rules.ticker, rules);
    if (protocol.spec.maxSupply !== rules.maxSupply || protocol.spec.mintAmount !== rules.mintAmount) throw new Error('This ticker has different published rules.');
    return protocol;
  }
  function setCommunitySpec(protocol) {
    P = protocol; T = P.spec.ticker; AMOUNT = BigInt(P.spec.mintAmount); MAX = BigInt(P.spec.maxSupply); LIMIT = P.spec.maxMintsPerWallet;
    if (S.config) S.config = { ...S.config, ticker: T, maxSupply: P.spec.maxSupply, mintAmount: P.spec.mintAmount, maxMintsPerWallet: LIMIT };
    $('deployTicker').value = T; $('deploySupply').value = String(MAX); $('deployAmount').value = String(AMOUNT);
    $('payload').textContent = P.DEPLOY; S.formValid = true;
  }
  function readJournal() {
    if (!S.account || !S.config) return null;
    let record;
    try { record = JSON.parse(localStorage.getItem(journalKey()) || 'null'); } catch (_) { throw new Error('Transaction recovery storage is unavailable. Enable site storage before continuing.'); }
    if (!record) return null;
    if (record.account?.toLowerCase() !== S.account.toLowerCase() || record.kind !== mode || record.chainId !== P.CHAIN_ID) throw new Error('The saved transaction record is invalid.');
    if (community) {
      const payload = JSON.parse(S.iface.decodeFunctionData('inscribe', record.data)[0]);
      if (payload.p !== 'rh-20' || payload.op !== 'deploy') throw new Error('Invalid saved registration.');
      setCommunitySpec(communitySpec(payload));
    }
    const data = transactionData();
    if (record.data !== data || (mode !== 'deploy' && !P.sameAddress(record.contract, S.config.contractAddress))) throw new Error(`The saved transaction does not match the published ${T} contract.`);
    return record;
  }
  function saveJournal(record) {
    localStorage.setItem(journalKey(record.account), JSON.stringify(record));
    if (P.sameAddress(record.account, S.account)) S.pending = record;
  }
  function finishJournal(record, receipt) {
    const completed = { ...record, ...receipt, completed: true };
    saveJournal(completed);
    if (P.sameAddress(record.account, S.account)) { S.pending = null; S.receipt = completed; }
    // A confirmed deployment stays in storage to prevent accidental redeployment.
    if (mode === 'mint') localStorage.removeItem(journalKey(record.account));
    return completed;
  }
  function loadJournal() {
    const record = readJournal();
    S.pending = record && !record.completed ? record : null;
    S.receipt = record?.completed ? record : null;
    if (mode !== 'mint' && S.receipt?.contractAddress) showDeployment(S.receipt);
    renderRecovery();
  }
  function renderRecovery() {
    const record = S.pending;
    $('recovery').hidden = !record;
    if (!record) return;
    $('recoveryTitle').textContent = mode === 'deploy' ? 'Pending deployment' : mode === 'register' ? 'Pending token registration' : 'Pending mint';
    $('recoveryText').textContent = record.hash ? 'Your transaction is saved. Checking it will not submit another transaction.' : 'A wallet request is unresolved. Check wallet activity and paste its transaction hash if it was broadcast. This page will not resend it automatically.';
    $('hashRecovery').hidden = false;
    $('checkPending').hidden = !record.hash;
    $('pendingLink').hidden = !record.hash;
    if (record.hash) { $('pendingLink').href = S.config.explorerUrl + '/tx/' + record.hash; $('pendingLink').textContent = 'View transaction ↗'; }
  }
  function render() {
    $('connectButton').textContent = S.account ? short(S.account) : 'Connect wallet';
    $('connectButton').disabled = S.busy || !S.config;
    $('walletSelect').disabled = S.busy;
    window.dispatchEvent(new CustomEvent('rh20:mint-state', { detail: { ticker: T, verified: S.verified, token: S.token } }));
    if (community) {
      for (const id of ['deployTicker', 'deploySupply', 'deployAmount']) $(id).disabled = !S.config || S.busy || !!S.pending || !!S.receipt;
      $('newToken').hidden = !S.receipt;
    }
    if (mode === 'register') {
      const button = $('deployButton');
      button.disabled = !S.artifact || !S.verified || S.busy || !!S.pending || !!S.token || !!S.receipt?.contractAddress || (community && (!S.formValid || !S.communityReady));
      button.textContent = S.busy ? 'Check your wallet…' : community && !S.communityReady ? 'Opens after VLAD registration' : community && !S.formValid ? 'Enter token details' : S.pending ? 'Registration pending' : S.token || S.receipt?.contractAddress ? T + ' registered' : !S.verified ? 'Checking registry' : !S.account ? 'Connect wallet to register ' + T : 'Register ' + T;
      $('launchBadge').textContent = S.token ? 'Registered' : S.verified ? 'Ready to register' : 'Checking registry';
      return;
    }
    if (mode === 'deploy') {
      const button = $('deployButton');
      button.disabled = !S.artifact || S.busy || !!S.pending || !!S.config?.contractAddress || !!S.receipt?.contractAddress;
      button.textContent = S.busy ? 'Check your wallet…' : S.config?.contractAddress || S.receipt?.contractAddress ? 'Contract deployed' : S.pending ? 'Deployment pending' : !S.account ? 'Connect wallet to deploy' : `Deploy RH-20 + ${T}`;
      return;
    }
    if (S.token) {
      const supply = BigInt(S.token.totalSupply);
      $('mintedSupply').textContent = fmt(supply) + ' / ' + fmt(MAX);
      $('mintPercent').textContent = (Number(supply) / Number(MAX) * 100).toFixed(2) + '%';
      $('mintEvents').textContent = fmt(supply / AMOUNT);
      $('progressFill').style.width = Number(supply) / Number(MAX) * 100 + '%';
      $('supplyProgress').setAttribute('aria-valuenow', String(supply));
    }
    $('balance').textContent = S.account && S.verified ? fmt(S.balance) : '—';
    $('walletMints').textContent = (S.account && S.verified ? fmt(S.count) : '—') + (LIMIT ? ' / ' + LIMIT : ' / Unlimited');
    const state = S.token ? P.mintState(S.token.totalSupply, S.count) : null;
    $('launchBadge').textContent = !S.config?.contractAddress ? 'Awaiting deployment' : !S.verified ? 'Verifying contract' : !S.token ? 'Awaiting registration' : state?.soldOut ? 'Mint complete' : 'Mint open';
    const button = $('mintButton');
    button.disabled = S.busy || !S.config?.contractAddress || !S.verified || !S.token || !!S.pending || !!state?.soldOut || (!!S.account && !!state?.walletComplete);
    button.textContent = S.busy ? 'Check your wallet…' : !S.config?.contractAddress ? 'Mint opens after deployment' : S.pending ? 'Mint transaction pending' : !S.verified ? 'Checking mint availability' : !S.token ? 'Mint opens after registration' : state?.soldOut ? `All ${T} minted` : !S.account ? 'Connect wallet to mint' : state?.walletComplete ? `${LIMIT} / ${LIMIT} mints completed` : S.chain !== P.CHAIN_ID ? 'Switch to Robinhood Chain' : `Mint ${AMOUNT} ${T}`;
  }
  function showContract(address) {
    $('contractLink').hidden = false; $('contractLink').replaceChildren();
    const link = document.createElement('a'); link.href = S.config.explorerUrl + '/address/' + address; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'RH-20 contract · ' + short(address) + ' ↗';
    $('contractLink').append(link);
  }
  function showDeployment(record) {
    if (mode === 'mint' || !record.contractAddress) return;
    $('deploymentReceipt').hidden = false;
    $('deployedAddress').textContent = record.contractAddress;
    $('deploymentTxLink').textContent = record.hash;
    $('deploymentTxLink').href = S.config.explorerUrl + '/tx/' + record.hash;
    showContract(record.contractAddress);
    if ($('openMint')) { $('openMint').href = '/rh20.html?tick=' + T; $('openMint').textContent = 'Open ' + T + ' mint ↗'; }
  }

  async function verifyContract(provider, address, blockTag) {
    const code = await deadline(provider.getCode(address, blockTag));
    if (code === '0x' || E.keccak256(code) !== S.artifact.runtimeCodeHash) throw new Error('Contract verification failed. Minting is disabled.');
    const contract = new E.Contract(address, S.artifact.abi, provider);
    let token;
    try { token = await deadline(contract.getToken(T, { blockTag })); }
    catch (error) {
      if (T === 'RHSC' || String(error.data || '').toLowerCase() !== E.id('UnknownToken()').slice(0, 10)) throw error;
      return { contract, token: null };
    }
    P.validateToken(token);
    return { contract, token };
  }
  async function refresh() {
    if (!S.config || !S.artifact) return;
    if (S.refreshing) { S.refreshAgain = true; return; }
    if (!S.config.contractAddress) {
      S.verified = false;
      if (mode === 'mint' && !S.pending) status(`The official ${T} contract has not been published yet. Minting will open here after deployment.`);
      render(); return;
    }
    S.refreshing = true;
    const generation = S.generation, account = S.account;
    try {
      const provider = reader();
      const blockTag = Number(BigInt(await deadline(provider.send('eth_blockNumber', []))));
      const { contract, token } = await verifyContract(provider, S.config.contractAddress, blockTag);
      if (community) {
        try { library.forToken('VLAD').validateToken(await deadline(contract.getToken('VLAD', { blockTag }))); S.communityReady = true; }
        catch (error) { S.communityReady = false; if (String(error.data || '').toLowerCase() !== E.id('UnknownToken()').slice(0, 10)) throw error; }
      }
      const [balance, count] = account && token ? await deadline(Promise.all([contract.balanceOf(T, account, { blockTag }), contract.mintCount(T, account, { blockTag })])) : [0n, 0n];
      if (token) P.mintState(token.totalSupply, count);
      if (generation !== S.generation || !P.sameAddress(account || '', S.account || '')) return;
      S.token = token; S.balance = balance; S.count = count; S.verified = true;
      showContract(S.config.contractAddress);
      if (community && !S.busy && !S.pending && !S.communityReady) status('Community deployment opens after VLAD registration. Token numbers follow the on-chain deployment order.');
      else if (community && !S.busy && !S.pending && !S.formValid) status('Choose a unique ticker, total supply and amount per mint.');
      else if (!S.pending && !S.busy && !token) status(mode === 'register' ? `The official RH-20 registry is verified. Register ${T} with one wallet transaction.` : 'VLAD is awaiting on-chain registration. Minting opens automatically after its token rules are verified.');
      else if (!S.pending && !S.busy) status(mode === 'register' ? `${T} is already registered. Choose another ticker or open its mint page.` : mode === 'deploy' ? `The official RH-20 contract is already deployed. Use the ${T} mint page.` : BigInt(token.totalSupply) === MAX ? `All ${fmt(MAX / AMOUNT)} mints are complete.` : LIMIT && count >= BigInt(LIMIT) ? `This wallet has completed all ${LIMIT} mints. Transferring tokens does not reset this limit.` : account ? `Ready to mint ${AMOUNT} ${T}. Confirm one transaction in your wallet.` : `Connect your wallet to mint ${AMOUNT} ${T}.`);
    } catch (error) {
      if (generation === S.generation) { S.verified = false; if (!S.pending && !S.busy) status(P.message(error), 'error'); }
    } finally {
      S.refreshing = false; render();
      if (S.refreshAgain) { S.refreshAgain = false; void refresh(); }
    }
  }
  async function updateAccount() {
    if (!S.wallet) return;
    const generation = ++S.generation;
    const [accounts, chain] = await Promise.all([S.wallet.request({ method: 'eth_accounts' }), S.wallet.request({ method: 'eth_chainId' })]);
    if (generation !== S.generation) return;
    S.account = accounts[0] ? E.getAddress(accounts[0]) : null;
    S.chain = Number(BigInt(chain)); S.provider = new E.BrowserProvider(S.wallet, 'any');
    S.verified = false; S.balance = 0n; S.count = 0n; S.pending = null; S.receipt = null;
    if (mode !== 'mint') $('deploymentReceipt').hidden = true;
    loadJournal(); render();
    if (S.chain !== P.CHAIN_ID && S.account) status('Switch your wallet to Robinhood Chain before submitting a transaction.');
    await refresh();
    if (S.pending?.hash && S.chain === P.CHAIN_ID) await checkPending();
  }
  function walletChanged() { updateAccount().catch(error => { status(P.message(error), 'error'); render(); }); }
  async function connect() {
    legacyWallets();
    const selected = S.wallets[Number($('walletSelect').value || 0)];
    if (!selected) throw new Error('Open this page in a browser with MetaMask, Rabby, or another EVM wallet installed.');
    if (S.wallet?.removeListener) { S.wallet.removeListener('accountsChanged', walletChanged); S.wallet.removeListener('chainChanged', walletChanged); }
    S.wallet = selected.provider;
    S.wallet.on?.('accountsChanged', walletChanged); S.wallet.on?.('chainChanged', walletChanged);
    await S.wallet.request({ method: 'eth_requestAccounts' });
    await updateAccount();
  }
  async function ensureMainnet() {
    if (!S.account) await connect();
    if (Number(BigInt(await S.wallet.request({ method: 'eth_chainId' }))) !== P.CHAIN_ID) {
      try { await S.wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] }); }
      catch (error) {
        if (error?.code !== 4902 && error?.data?.originalError?.code !== 4902) throw error;
        await S.wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x1237', chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [S.config.rpcUrl], blockExplorerUrls: [S.config.explorerUrl] }] });
        await S.wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] });
      }
    }
    await updateAccount();
    if (!S.account || S.chain !== P.CHAIN_ID) throw new Error('Select Robinhood Chain in your wallet.');
  }
  async function checkPending(hashOverride) {
    if (S.checking || !S.account || S.chain !== P.CHAIN_ID) return;
    const record = S.pending, generation = S.generation;
    if (!record) return;
    const hash = typeof hashOverride === 'string' ? hashOverride.trim() : record.hash;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) { status('Paste the full transaction hash from your wallet activity.'); return; }
    S.checking = true;
    try {
      const provider = S.provider;
      const tx = await deadline(provider.getTransaction(hash));
      if (generation !== S.generation) return;
      if (!tx) { status('The RPC has not returned this transaction yet. Your saved request is retained; no new transaction was sent.'); return; }
      if (!P.matchesTransaction(tx, record)) throw new Error('This transaction does not match this wallet, operation, and saved nonce.');
      const updated = { ...record, hash }; saveJournal(updated);
      const receipt = await deadline(provider.getTransactionReceipt(hash));
      if (!receipt) { status('Transaction submitted. Waiting for confirmation on Robinhood Chain.'); return; }
      const block = await deadline(provider.getBlock(receipt.blockNumber));
      if (generation !== S.generation) return;
      if (!block || block.hash !== receipt.blockHash || tx.blockHash !== receipt.blockHash) throw new Error('The receipt is not yet canonical. Your transaction record has been retained.');
      if (receipt.status !== 1) {
        localStorage.removeItem(journalKey(record.account));
        if (P.sameAddress(record.account, S.account)) { S.pending = null; status(`The transaction reverted. No ${T} was minted. Network gas may have been charged.`, 'error'); }
        return;
      }
      if (record.kind === 'register') {
        const deployed = receipt.logs.filter(log => P.sameAddress(log.address, record.contract)).map(log => { try { return S.iface.parseLog(log); } catch (_) { return null; } }).find(log => log?.name === 'TokenDeployed' && log.args.tokenId === E.id(T) && log.args.tick === T && log.args.maxSupply === MAX && log.args.mintAmount === AMOUNT && log.args.maxMintsPerWallet === BigInt(LIMIT) && P.sameAddress(log.args.deployer, record.account));
        if (!deployed) throw new Error(`No matching ${T} registration event. Your transaction record has been retained.`);
        const verified = await verifyContract(provider, record.contract, 'latest');
        if (generation !== S.generation) return;
        if (!verified.token) throw new Error('The registered token is not yet available. Check again.');
        const completed = finishJournal(updated, { contractAddress: record.contract, deploymentBlock: receipt.blockNumber });
        if (P.sameAddress(record.account, S.account)) { showDeployment(completed); await refresh(); status(`${T} registration confirmed. Minting is now available on the public RH-20 page.`, 'success'); }
      } else if (record.kind === 'deploy') {
        if (!receipt.contractAddress) throw new Error('The receipt contains no contract address.');
        await verifyContract(provider, receipt.contractAddress, 'latest');
        const completed = finishJournal(updated, { contractAddress: receipt.contractAddress, deploymentBlock: receipt.blockNumber });
        if (P.sameAddress(record.account, S.account)) { showDeployment(completed); status(`RH-20 and ${T} are deployed. Copy the deployment details to publish the official mint address.`, 'success'); }
      } else {
        const mint = receipt.logs.filter(log => P.sameAddress(log.address, record.contract)).map(log => { try { return S.iface.parseLog(log); } catch (_) { return null; } }).find(log => log?.name === 'Mint' && log.args.tokenId === E.id(T) && P.sameAddress(log.args.account, record.account) && log.args.amount === AMOUNT);
        if (!mint) throw new Error(`The receipt has no matching ${T} mint event. Your record has been retained.`);
        finishJournal(updated, { blockNumber: receipt.blockNumber });
        await refresh();
        if (P.sameAddress(record.account, S.account)) { status(`Mint confirmed: ${AMOUNT} ${T} received.`, 'success'); const link = document.createElement('a'); link.href = S.config.explorerUrl + '/tx/' + hash; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = ' View transaction ↗'; $('status').append(link); }
      }
    } catch (error) { status(P.message(error), 'error'); }
    finally { S.checking = false; renderRecovery(); render(); }
  }

  async function submit() {
    if (S.busy || !S.config || !S.artifact) return;
    S.busy = true; render();
    let intent = null, sent = false;
    try {
      if (mode !== 'deploy' && !S.config.contractAddress) throw new Error('The official mint contract has not been published.');
      if (mode === 'deploy' && S.config.contractAddress) throw new Error('The official RH-20 contract is already deployed.');
      if (community && (!S.formValid || !S.communityReady)) throw new Error('Complete the token details after VLAD registration.');
      await ensureMainnet();
      const account = S.account;
      const run = async () => {
        const saved = readJournal();
        if (saved && (!saved.completed || saved.contractAddress)) throw new Error('A transaction already exists for this wallet. Recover it before continuing.');
        const provider = S.provider;
        if (mode !== 'deploy') {
          const block = Number(BigInt(await deadline(provider.send('eth_blockNumber', []))));
          const { contract, token } = await verifyContract(provider, S.config.contractAddress, block);
          if (mode === 'register') {
            if (community) library.forToken('VLAD').validateToken(await deadline(contract.getToken('VLAD', { blockTag: block })));
            if (token) throw new Error(`${T} is already registered. No new transaction is needed.`);
          } else {
          if (!token) throw new Error('VLAD is not registered yet.');
          const count = await deadline(contract.mintCount(T, account, { blockTag: block }));
          const state = P.mintState(token.totalSupply, count);
          if (state.soldOut) throw new Error(`All ${T} has been minted.`);
          if (state.walletComplete) throw new Error(`This wallet has completed all ${LIMIT} mints.`);
          }
        }
        const signer = await provider.getSigner(account);
        const nonce = Number(BigInt(await deadline(provider.send('eth_getTransactionCount', [account, 'pending']))));
        const data = transactionData();
        const request = { from: account, data, value: 0n, chainId: P.CHAIN_ID, nonce };
        if (mode !== 'deploy') request.to = S.config.contractAddress;
        const gas = await deadline(provider.estimateGas(request));
        const accounts = await S.wallet.request({ method: 'eth_accounts' });
        const chain = await S.wallet.request({ method: 'eth_chainId' });
        if (!P.sameAddress(accounts[0], account) || Number(BigInt(chain)) !== P.CHAIN_ID) throw new Error('Wallet or network changed. Review your wallet and try again.');
        intent = { kind: mode, chainId: P.CHAIN_ID, account, contract: mode !== 'deploy' ? S.config.contractAddress : null, data, nonce, createdAt: Date.now(), hash: null, completed: false };
        saveJournal(intent); renderRecovery();
        status(mode === 'mint' ? 'Confirm the mint transaction in your wallet. Mint fee is zero; gas applies.' : mode === 'register' ? `Confirm ${T} registration in the existing RH-20 registry. No new contract is created. Network gas applies.` : 'Confirm contract deployment in your wallet. Your wallet will show the ETH gas fee.');
        const tx = await signer.sendTransaction({ ...request, gasLimit: (gas * 120n + 99n) / 100n });
        sent = true;
        intent = { ...intent, hash: tx.hash, nonce: tx.nonce };
        saveJournal(intent);
        status('Transaction submitted. Your transaction hash has been saved.');
      };
      if (navigator.locks) await navigator.locks.request(journalKey(account), { ifAvailable: true }, lock => { if (!lock) throw new Error('This wallet has an active transaction in another tab.'); return run(); });
      else await run();
    } catch (error) {
      if (intent && !sent && (error?.code === 4001 || error?.code === 'ACTION_REJECTED')) {
        localStorage.removeItem(journalKey(intent.account)); if (P.sameAddress(intent.account, S.account)) S.pending = null;
      }
      status(intent && !sent && S.pending ? 'Wallet response unresolved. Check wallet activity before submitting anything else. ' + P.message(error) : P.message(error), 'error');
    } finally {
      S.busy = false; renderRecovery(); render();
      if (S.pending?.hash) await checkPending();
    }
  }

  if (community) {
    let formTimer;
    function changed() {
      if (S.busy || S.pending || S.receipt) return;
      S.formValid = false; S.token = null; S.verified = false; ++S.generation;
      try {
        setCommunitySpec(communitySpec({ tick: $('deployTicker').value.trim().toUpperCase(), max: $('deploySupply').value.trim(), lim: $('deployAmount').value.trim() }));
        clearTimeout(formTimer); formTimer = setTimeout(refresh, 350);
      } catch (error) { status(P.message(error)); }
      render();
    }
    for (const id of ['deployTicker', 'deploySupply', 'deployAmount']) $(id).addEventListener('input', changed);
    $('newToken').onclick = () => {
      if (S.busy || S.pending || !S.receipt) return;
      localStorage.removeItem(journalKey()); S.receipt = null; S.formValid = false; S.token = null;
      $('deploymentReceipt').hidden = true;
      for (const id of ['deployTicker','deploySupply','deployAmount']) $(id).value = '';
      $('payload').textContent = 'Enter token details to preview the inscription.'; render();
    };
  }
  $('connectButton').onclick = () => { if (!S.busy && S.config) connect().catch(error => status(P.message(error), 'error')); };
  $('walletSelect').onchange = () => { if (!S.busy && S.account) connect().catch(error => status(P.message(error), 'error')); };
  if ($('mintButton')) $('mintButton').onclick = submit;
  if ($('deployButton')) $('deployButton').onclick = submit;
  $('checkPending').onclick = () => checkPending();
  $('recoverHash').onclick = () => checkPending($('transactionHash').value);
  if ($('copyDeployment')) $('copyDeployment').onclick = async () => {
    if (!S.receipt?.contractAddress) return;
    const details = { operation: mode === 'register' ? 'register-token' : 'deploy-contract', chainId: P.CHAIN_ID, contractAddress: S.receipt.contractAddress, deploymentTxHash: S.receipt.hash, deploymentBlock: S.receipt.deploymentBlock, ticker: T, maxSupply: P.spec.maxSupply, mintAmount: P.spec.mintAmount, maxMintsPerWallet: LIMIT };
    try { await navigator.clipboard.writeText(JSON.stringify(details, null, 2)); toast('Deployment details copied'); } catch (_) { toast('Copy unavailable. Copy the address and transaction above.'); }
  };
  window.addEventListener('storage', event => { if (S.account && event.key === journalKey()) { try { loadJournal(); render(); } catch (error) { status(P.message(error), 'error'); } } });
  async function tick() { if (!document.hidden && !S.busy) { if (S.pending?.hash) await checkPending(); else await refresh(); } clearTimeout(S.timer); S.timer = setTimeout(tick, 20000); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(S.timer); tick(); } });
  async function init() {
    if (!P || !E) throw new Error('Wallet library failed to load. Refresh this page.');
    const fetchJSON = async url => { const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error('Unable to load published deployment settings.'); return response.json(); };
    let [config, artifact] = await Promise.all([fetchJSON(P.spec.configPath), fetchJSON(P.spec.artifactPath)]);
    if (artifact.chainId !== P.CHAIN_ID || !/^0x[0-9a-f]+$/i.test(artifact.bytecode) || E.keccak256(artifact.deployedBytecode) !== artifact.runtimeCodeHash) throw new Error('Invalid RH-20 deployment artifact.');
    S.artifact = artifact; S.iface = new E.Interface(artifact.abi);
    const connection = new E.FetchRequest(new URL('/api/rh20', location.origin).href); connection.timeout = 12000;
    S.publicReader = new E.JsonRpcProvider(connection, P.CHAIN_ID, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
    if (!Object.hasOwn(library.catalog, T)) {
      if (!/^[A-Z0-9]{2,12}$/.test(T)) throw new Error('Invalid ticker.');
      const blockTag = Number(BigInt(await S.publicReader.send('eth_blockNumber', [])));
      if (E.keccak256(await S.publicReader.getCode(config.contractAddress, blockTag)) !== artifact.runtimeCodeHash) throw new Error('Registry verification failed.');
      const token = await new E.Contract(config.contractAddress, artifact.abi, S.publicReader).getToken(T, { blockTag });
      P = library.forToken(T, { maxSupply: String(token.maxSupply), mintAmount: String(token.mintAmount) });
      P.validateToken(token);
      AMOUNT = BigInt(P.spec.mintAmount); MAX = BigInt(P.spec.maxSupply); LIMIT = P.spec.maxMintsPerWallet;
      config = { ...config, ticker: T, maxSupply: P.spec.maxSupply, mintAmount: P.spec.mintAmount, maxMintsPerWallet: LIMIT };
    }
    S.config = P.validateConfig(config);
    window.dispatchEvent(new CustomEvent('rh20:token-spec', { detail: P.spec }));
    if (mode === 'deploy') status(config.contractAddress ? 'The official contract is already published.' : 'Connect the deployment wallet. This action deploys to Robinhood Chain mainnet.');
    render(); await refresh(); tick();
  }
  init().catch(error => { status(P.message(error), 'error'); $('connectButton').disabled = true; });
})();

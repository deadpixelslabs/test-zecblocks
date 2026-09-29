// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice RH-20 token registry on Robinhood Chain. Amounts are whole tokens.
/// @dev No owner mint, upgrade, pause, balance override, or fee withdrawal exists.
contract RH20 {
    uint256 public constant CHAIN_ID = 4663;
    uint256 public constant RHSC_MAX_SUPPLY = 21_000_000;
    uint256 public constant RHSC_MINT_AMOUNT = 500;
    uint32 public constant RHSC_WALLET_MINT_LIMIT = 20;
    bytes32 public constant RHSC_ID = keccak256("RHSC");
    string public constant RHSC_DEPLOY_PAYLOAD = '{"p":"rh-20","op":"deploy","tick":"RHSC","max":"21000000","lim":"500"}';
    string public constant RHSC_MINT_PAYLOAD = '{"p":"rh-20","op":"mint","tick":"RHSC","amt":"500"}';

    // Set only by the constructor; neither field grants administrative powers.
    address public genesisDeployer;
    uint256 public genesisBlock;

    struct Token {
        string tick;
        uint256 maxSupply;
        uint256 mintAmount;
        uint256 totalSupply;
        address deployer;
        uint32 maxMintsPerWallet;
        bool exists;
    }

    struct Operation {
        bool isDeploy;
        string tick;
        uint256 amount;
        uint256 limit;
    }

    mapping(bytes32 => Token) private _tokens;
    mapping(bytes32 => mapping(address => uint256)) private _balances;
    mapping(bytes32 => mapping(address => uint256)) private _mintCounts;
    mapping(bytes32 => mapping(address => mapping(address => uint256))) private _allowances;

    error WrongChain();
    error InvalidPayload();
    error InvalidTicker();
    error InvalidAmount();
    error TokenAlreadyExists();
    error UnknownToken();
    error SupplyExhausted();
    error WalletMintLimitReached();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();

    event Genesis(address indexed deployer, uint256 indexed chainId, bytes32 indexed rhscId);
    event TokenDeployed(bytes32 indexed tokenId, string tick, uint256 maxSupply, uint256 mintAmount, uint32 maxMintsPerWallet, address indexed deployer);
    event Inscription(address indexed sender, bytes32 indexed tokenId, string payload);
    event Mint(bytes32 indexed tokenId, address indexed account, uint256 amount, uint256 walletMintCount, uint256 totalSupply);
    event Transfer(bytes32 indexed tokenId, address indexed from, address indexed to, uint256 amount);
    event Approval(bytes32 indexed tokenId, address indexed account, address indexed spender, uint256 amount);

    constructor() {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        genesisDeployer = msg.sender;
        genesisBlock = block.number;
        emit Genesis(msg.sender, block.chainid, RHSC_ID);
        _deploy("RHSC", RHSC_MAX_SUPPLY, RHSC_MINT_AMOUNT, RHSC_WALLET_MINT_LIMIT);
        emit Inscription(msg.sender, RHSC_ID, RHSC_DEPLOY_PAYLOAD);
    }

    /// @notice Execute canonical RH-20 deploy or mint JSON without sending ETH.
    /// @dev Exact field order and numeric strings eliminate ambiguous JSON parses.
    function inscribe(string calldata payload) external {
        Operation memory op = _parse(bytes(payload));
        bytes32 id = _tickerId(bytes(op.tick));
        if (op.isDeploy) {
            // RHSC is registered atomically in the constructor and cannot be replaced.
            // Other tickers use their own immutable supply and mint amount, with no
            // wallet cap. The owner's 20-mint rule applies specifically to RHSC.
            _deploy(op.tick, op.amount, op.limit, 0);
        } else {
            _mint(id, op.amount);
        }
        emit Inscription(msg.sender, id, payload);
    }

    function getToken(string calldata tick) external view returns (Token memory) {
        bytes32 id = _tickerId(bytes(tick));
        if (!_tokens[id].exists) revert UnknownToken();
        return _tokens[id];
    }

    function balanceOf(string calldata tick, address account) external view returns (uint256) {
        return _balances[_tickerId(bytes(tick))][account];
    }

    function mintCount(string calldata tick, address account) external view returns (uint256) {
        return _mintCounts[_tickerId(bytes(tick))][account];
    }

    function allowance(string calldata tick, address account, address spender) external view returns (uint256) {
        return _allowances[_tickerId(bytes(tick))][account][spender];
    }

    function approve(string calldata tick, address spender, uint256 amount) external returns (bool) {
        bytes32 id = _tickerId(bytes(tick));
        if (!_tokens[id].exists) revert UnknownToken();
        if (spender == address(0)) revert ZeroAddress();
        _allowances[id][msg.sender][spender] = amount;
        emit Approval(id, msg.sender, spender, amount);
        return true;
    }

    function transfer(string calldata tick, address to, uint256 amount) external returns (bool) {
        _transfer(_tickerId(bytes(tick)), msg.sender, to, amount);
        return true;
    }

    /// @notice A future marketplace must have the seller's explicit allowance.
    function transferFrom(string calldata tick, address from, address to, uint256 amount) external returns (bool) {
        bytes32 id = _tickerId(bytes(tick));
        if (msg.sender != from) {
            uint256 permitted = _allowances[id][from][msg.sender];
            if (permitted < amount) revert InsufficientAllowance();
            if (permitted != type(uint256).max) {
                _allowances[id][from][msg.sender] = permitted - amount;
                emit Approval(id, from, msg.sender, permitted - amount);
            }
        }
        _transfer(id, from, to, amount);
        return true;
    }

    function _deploy(string memory tick, uint256 maxSupply, uint256 mintAmount, uint32 walletLimit) private {
        bytes32 id = _tickerId(bytes(tick));
        if (_tokens[id].exists) revert TokenAlreadyExists();
        if (maxSupply == 0 || mintAmount == 0 || mintAmount > maxSupply || maxSupply % mintAmount != 0) revert InvalidAmount();
        _tokens[id] = Token(tick, maxSupply, mintAmount, 0, msg.sender, walletLimit, true);
        emit TokenDeployed(id, tick, maxSupply, mintAmount, walletLimit, msg.sender);
    }

    function _mint(bytes32 id, uint256 amount) private {
        Token storage token = _tokens[id];
        if (!token.exists) revert UnknownToken();
        if (amount != token.mintAmount) revert InvalidAmount();
        if (amount > token.maxSupply - token.totalSupply) revert SupplyExhausted();
        uint256 count = _mintCounts[id][msg.sender];
        if (token.maxMintsPerWallet != 0 && count >= token.maxMintsPerWallet) revert WalletMintLimitReached();
        token.totalSupply += amount;
        _balances[id][msg.sender] += amount;
        _mintCounts[id][msg.sender] = count + 1;
        emit Transfer(id, address(0), msg.sender, amount);
        emit Mint(id, msg.sender, amount, count + 1, token.totalSupply);
    }

    function _transfer(bytes32 id, address from, address to, uint256 amount) private {
        if (!_tokens[id].exists) revert UnknownToken();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (_balances[id][from] < amount) revert InsufficientBalance();
        _balances[id][from] -= amount;
        _balances[id][to] += amount;
        // Lifetime mint counts are intentionally unaffected by transfers.
        emit Transfer(id, from, to, amount);
    }

    function _tickerId(bytes memory tick) private pure returns (bytes32) {
        if (tick.length < 2 || tick.length > 12) revert InvalidTicker();
        for (uint256 i; i < tick.length; ++i) {
            uint8 c = uint8(tick[i]);
            if (!((c >= 65 && c <= 90) || (c >= 48 && c <= 57))) revert InvalidTicker();
        }
        return keccak256(tick);
    }

    function _parse(bytes calldata data) private pure returns (Operation memory op) {
        if (data.length > 256) revert InvalidPayload();
        uint256 cursor = _consume(data, 0, bytes('{"p":"rh-20","op":"'));
        string memory name;
        (name, cursor) = _readString(data, cursor);
        bytes32 operation = keccak256(bytes(name));
        if (operation == keccak256("deploy")) op.isDeploy = true;
        else if (operation != keccak256("mint")) revert InvalidPayload();
        cursor = _consume(data, cursor, bytes(',"tick":"'));
        (op.tick, cursor) = _readString(data, cursor);
        if (op.isDeploy) {
            cursor = _consume(data, cursor, bytes(',"max":"'));
            (op.amount, cursor) = _readNumber(data, cursor);
            cursor = _consume(data, cursor, bytes(',"lim":"'));
            (op.limit, cursor) = _readNumber(data, cursor);
        } else {
            cursor = _consume(data, cursor, bytes(',"amt":"'));
            (op.amount, cursor) = _readNumber(data, cursor);
        }
        cursor = _consume(data, cursor, bytes('}'));
        if (cursor != data.length) revert InvalidPayload();
    }

    function _consume(bytes calldata data, uint256 cursor, bytes memory literal) private pure returns (uint256) {
        if (cursor > data.length || literal.length > data.length - cursor) revert InvalidPayload();
        for (uint256 i; i < literal.length; ++i) {
            if (data[cursor + i] != literal[i]) revert InvalidPayload();
        }
        return cursor + literal.length;
    }

    function _readString(bytes calldata data, uint256 cursor) private pure returns (string memory, uint256) {
        uint256 start = cursor;
        while (cursor < data.length && data[cursor] != '"') {
            if (cursor - start >= 12) revert InvalidPayload();
            ++cursor;
        }
        if (cursor == data.length || cursor == start) revert InvalidPayload();
        return (string(data[start:cursor]), cursor + 1);
    }

    function _readNumber(bytes calldata data, uint256 cursor) private pure returns (uint256 value, uint256 next) {
        if (cursor >= data.length || data[cursor] < '1' || data[cursor] > '9') revert InvalidAmount();
        while (cursor < data.length && data[cursor] != '"') {
            uint8 c = uint8(data[cursor]);
            if (c < 48 || c > 57) revert InvalidAmount();
            uint256 digit = c - 48;
            if (value > (type(uint256).max - digit) / 10) revert InvalidAmount();
            value = value * 10 + digit;
            ++cursor;
        }
        if (cursor == data.length) revert InvalidPayload();
        return (value, cursor + 1);
    }
}

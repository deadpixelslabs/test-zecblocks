// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {RobinhoodOrdinalRenderer} from "./RobinhoodOrdinalRenderer.sol";

/// @title Robinhood Ordinal — 5,000 immutable generative inscriptions
/// @notice One NFT per mint; 0.00019 ETH protocol fee plus network gas.
/// @dev No owner, upgrade, premine, privileged mint, burn, URI setter or fee setter.
contract RobinhoodOrdinal is ERC721Enumerable, ReentrancyGuard {
    using Strings for uint256;

    uint256 public constant CHAIN_ID = 4663;
    uint256 public constant MAX_SUPPLY = 5000;
    uint256 public constant PROTOCOL_FEE = 190_000_000_000_000;
    address public constant TREASURY = 0x81046ab56F41a78077662624aC4116465fDf00cc;
    string public constant MINT_PAYLOAD = '{"p":"rh-ordinal","op":"mint","tick":"RHO"}';
    string public constant GENESIS_PAYLOAD = '{"p":"rh-ordinal","op":"deploy","tick":"RHO","max":"5000","fee":"190000000000000"}';

    // Written once in construction; no code path can change these values.
    RobinhoodOrdinalRenderer public renderer;
    address public genesisDeployer;
    uint256 public genesisBlock;
    uint256 public claimableProtocolFees;
    mapping(address => mapping(bytes32 => uint256)) public mintByRequest;

    error WrongChain();
    error InvalidPayload();
    error IncorrectPayment();
    error SupplyExhausted();
    error InvalidRequest();
    error RequestAlreadyMinted();
    error InvalidTokenId();
    error InvalidPage();
    error OnlyTreasury();
    error WithdrawalFailed();

    event Genesis(address indexed deployer, address indexed renderer, uint256 supply, uint256 protocolFee, address treasury, string payload);
    event Inscribed(address indexed account, uint256 indexed tokenId, bytes32 indexed requestId, uint16 designCode, uint256 protocolFee, string payload);
    event ProtocolFeeDeferred(uint256 amount);
    event ProtocolFeesWithdrawn(address indexed recipient, uint256 amount);

    constructor() ERC721("Robinhood Ordinal", "RHO") {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        genesisDeployer = msg.sender;
        genesisBlock = block.number;
        renderer = new RobinhoodOrdinalRenderer();
        emit Genesis(msg.sender, address(renderer), MAX_SUPPLY, PROTOCOL_FEE, TREASURY, GENESIS_PAYLOAD);
    }

    /// @notice Inscribe one NFT. The request ID prevents a repeated intent from paying twice.
    function inscribe(string calldata payload, bytes32 requestId) external payable nonReentrant returns (uint256 tokenId) {
        if (keccak256(bytes(payload)) != keccak256(bytes(MINT_PAYLOAD))) revert InvalidPayload();
        if (msg.value != PROTOCOL_FEE) revert IncorrectPayment();
        if (requestId == bytes32(0)) revert InvalidRequest();
        if (mintByRequest[msg.sender][requestId] != 0) revert RequestAlreadyMinted();
        tokenId = totalSupply() + 1;
        if (tokenId > MAX_SUPPLY) revert SupplyExhausted();
        mintByRequest[msg.sender][requestId] = tokenId;
        claimableProtocolFees += msg.value;
        _safeMint(msg.sender, tokenId);
        emit Inscribed(msg.sender, tokenId, requestId, designCode(tokenId), msg.value, payload);
        // The transaction is atomic: a rejected NFT receiver rolls back the NFT and fee.
        // A treasury that rejects ETH cannot block minting; its unpaid fee remains claimable.
        (bool paid,) = payable(TREASURY).call{value: msg.value, gas: 50_000}("");
        if (paid) claimableProtocolFees -= msg.value;
        else emit ProtocolFeeDeferred(msg.value);
    }

    /// @notice Only the fixed treasury may redirect its own previously deferred fees.
    function withdrawProtocolFees(address payable recipient) external nonReentrant {
        if (msg.sender != TREASURY) revert OnlyTreasury();
        uint256 amount = claimableProtocolFees;
        if (recipient == address(0) || amount == 0) revert WithdrawalFailed();
        claimableProtocolFees = 0;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert WithdrawalFailed();
        emit ProtocolFeesWithdrawn(recipient, amount);
    }

    /// @notice Fixed bijection into 16-bit designs; predictable, not a randomness oracle.
    /// @dev 40503 is odd, hence multiplication is invertible modulo 65536.
    function designCode(uint256 tokenId) public pure returns (uint16) {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert InvalidTokenId();
        return uint16(((tokenId - 1) * 40503 + 23040) & 65535);
    }

    function tokenSVG(uint256 tokenId) public view returns (string memory) {
        _requireOwned(tokenId);
        return renderer.renderSVG(designCode(tokenId));
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        string memory svg = tokenSVG(tokenId);
        (uint8 palette, uint8 core, uint8 crown, uint8 panels, uint8 seal) = renderer.traits(designCode(tokenId));
        string memory attributes = string.concat(
            '[{"trait_type":"Palette","value":"', _paletteName(palette),
            '"},{"trait_type":"Core","value":"', _coreName(core),
            '"},{"trait_type":"Crown","value":"', _crownName(crown),
            '"},{"trait_type":"Panels","value":"', _panelName(panels),
            '"},{"trait_type":"Seal","value":', uint256(seal).toString(), '}]'
        );
        return string.concat('data:application/json;base64,', Base64.encode(bytes(string.concat(
            '{"name":"Robinhood Ordinal #', tokenId.toString(),
            '","description":"An immutable generative block from the 5,000-piece Robinhood Ordinal collection by ZEC BLOCKS. SVG artwork and metadata are generated entirely from on-chain code.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)),
            '","attributes":', attributes, '}'
        ))));
    }

    /// @notice Bounded wallet inventory, with ownership maintained by ERC721Enumerable.
    function ownedTokens(address account, uint256 offset, uint256 limit) external view returns (uint256[] memory ids, uint256 total) {
        if (limit == 0 || limit > 24) revert InvalidPage();
        total = balanceOf(account);
        uint256 count = offset >= total ? 0 : (total - offset < limit ? total - offset : limit);
        ids = new uint256[](count);
        for (uint256 i; i < count; ++i) ids[i] = tokenOfOwnerByIndex(account, offset + i);
    }

    function collectionState(address account) external view returns (uint256 maxSupply, uint256 protocolFee, address treasury, address rendererAddress, uint256 minted, uint256 owned) {
        return (MAX_SUPPLY, PROTOCOL_FEE, TREASURY, address(renderer), totalSupply(), account == address(0) ? 0 : balanceOf(account));
    }

    function _paletteName(uint8 p) private pure returns (string memory) {
        return p == 0 ? "Volt" : p == 1 ? "Canopy" : p == 2 ? "Lime" : "Jade";
    }
    function _coreName(uint8 p) private pure returns (string memory) {
        return p == 0 ? "Monolith" : p == 1 ? "Stepped" : p == 2 ? "Quad" : "Cross";
    }
    function _crownName(uint8 p) private pure returns (string memory) {
        return p == 0 ? "Channels" : p == 1 ? "Split" : p == 2 ? "Triple" : "Segments";
    }
    function _panelName(uint8 p) private pure returns (string memory) {
        return p == 0 ? "Asymmetric" : p == 1 ? "Triptych" : p == 2 ? "Parallel" : "Circuit";
    }
}

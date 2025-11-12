# VeriOrigin: Verifiable Origin Claims for Global Trade

## Overview

VeriOrigin is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It provides a decentralized platform for creating, verifying, and tracking verifiable claims about the origin of goods in supply chains. By integrating with customs APIs (via off-chain oracles), it solves real-world problems like counterfeit products, regulatory non-compliance, illegal trade, and inefficient customs processes. This ensures transparency, authenticity, and streamlined international shipments.

### Key Problems Solved
- **Counterfeit Goods**: Verifiable on-chain claims prevent fake origins, reducing losses estimated at $500B+ annually in global trade.
- **Supply Chain Opacity**: Tracks product journeys from origin to destination, aiding in recalls and ethical sourcing (e.g., conflict-free minerals).
- **Customs Delays**: Integrates with APIs from customs authorities (e.g., US CBP, EU customs) via oracles to automate compliance checks, speeding up border clearances.
- **Regulatory Compliance**: Ensures goods meet origin rules (e.g., for tariffs under USMCA or EU trade agreements) with tamper-proof records.
- **Trust in Trade**: Enables buyers, sellers, and regulators to verify claims without intermediaries, reducing fraud in industries like agriculture, pharmaceuticals, and luxury goods.

The system uses NFTs to represent product batches, verifiable credentials for origins, and oracles for real-time customs data. Users (manufacturers, shippers, customs agents) interact via a dApp.

## Architecture
- **Blockchain**: Stacks (Bitcoin-secured, Clarity contracts).
- **Off-Chain Components**: Oracle (e.g., based on Chainlink or custom) to fetch customs API data (e.g., tariff codes, import restrictions). A frontend dApp for user interactions.
- **Smart Contracts**: 6 core contracts (described below) for modularity: registration, claiming, tracking, verification, integration, and governance.
- **Flow**:
  1. Manufacturer registers a product batch as an NFT.
  2. Creates origin claim (e.g., "Made in USA").
  3. Tracks supply chain steps.
  4. Verifies claims via third parties.
  5. Integrates with customs API data for compliance.
  6. Governance for updates.

Contracts are designed to be secure, using Clarity's predictability (no reentrancy, explicit errors). No loops; recursion with bounds.

## Smart Contracts
The project involves 6 solid smart contracts written in Clarity. Each is in a separate file (e.g., `product-registry.clar`). Below are descriptions and full code listings.

### 1. ProductRegistry Contract
Registers products/batches as NFTs. Handles minting unique IDs for traceability.

```clarity
;; product-registry.clar
;; Registers products as NFTs for unique identification.

(define-non-fungible-token product-batch uint)

(define-map product-metadata uint { origin-country: (string-ascii 64), description: (string-ascii 256), manufacturer: principal })

(define-data-var next-id uint u1)

(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-ALREADY-EXISTS (err u101))

(define-public (register-product (origin-country (string-ascii 64)) (description (string-ascii 256)))
  (let ((id (var-get next-id)))
    (try! (nft-mint? product-batch id tx-sender))
    (map-set product-metadata id { origin-country: origin-country, description: description, manufacturer: tx-sender })
    (var-set next-id (+ id u1))
    (ok id)))

(define-read-only (get-product-info (id uint))
  (map-get? product-metadata id))

(define-public (transfer-product (id uint) (recipient principal))
  (asserts! (is-eq (unwrap! (nft-get-owner? product-batch id) ERR-UNAUTHORIZED) tx-sender) ERR-UNAUTHORIZED)
  (nft-transfer? product-batch id tx-sender recipient))
```

### 2. OriginClaim Contract
Creates and stores verifiable claims about origin (e.g., certificates of origin).

```clarity
;; origin-claim.clar
;; Manages verifiable origin claims linked to products.

(define-map claims uint { claim-type: (string-ascii 64), evidence-hash: (buff 32), issuer: principal, timestamp: uint })

(define-constant ERR-INVALID-PRODUCT (err u200))
(define-constant ERR-UNAUTHORIZED (err u201))

(define-public (create-claim (product-id uint) (claim-type (string-ascii 64)) (evidence-hash (buff 32)))
  (begin
    (asserts! (is-some (contract-call? .product-registry get-product-info product-id)) ERR-INVALID-PRODUCT)
    (asserts! (is-eq tx-sender (get manufacturer (unwrap! (contract-call? .product-registry get-product-info product-id) ERR-INVALID-PRODUCT))) ERR-UNAUTHORIZED)
    (map-set claims product-id { claim-type: claim-type, evidence-hash: evidence-hash, issuer: tx-sender, timestamp: block-height })
    (ok true)))

(define-read-only (get-claim (product-id uint))
  (map-get? claims product-id))

(define-public (update-claim-evidence (product-id uint) (new-hash (buff 32)))
  (let ((claim (unwrap! (map-get? claims product-id) ERR-INVALID-PRODUCT)))
    (asserts! (is-eq tx-sender (get issuer claim)) ERR-UNAUTHORIZED)
    (map-set claims product-id (merge claim { evidence-hash: new-hash }))
    (ok true)))
```

### 3. SupplyChainTracker Contract
Tracks custody changes and steps in the supply chain.

```clarity
;; supply-chain-tracker.clar
;; Tracks supply chain events for products.

(define-map chain-events uint (list 100 { handler: principal, action: (string-ascii 64), timestamp: uint, location: (string-ascii 128) }))

(define-constant ERR-INVALID-PRODUCT (err u300))
(define-constant ERR-UNAUTHORIZED (err u301))
(define-constant MAX-EVENTS u100)

(define-public (add-event (product-id uint) (action (string-ascii 64)) (location (string-ascii 128)))
  (let ((events (default-to (list) (map-get? chain-events product-id))))
    (asserts! (is-some (contract-call? .product-registry get-product-info product-id)) ERR-INVALID-PRODUCT)
    (asserts! (is-eq (unwrap! (nft-get-owner? .product-registry product-batch product-id) ERR-UNAUTHORIZED) tx-sender) ERR-UNAUTHORIZED)
    (asserts! (< (len events) MAX-EVENTS) (err u302))
    (map-set chain-events product-id (append events { handler: tx-sender, action: action, timestamp: block-height, location: location }))
    (ok true)))

(define-read-only (get-events (product-id uint))
  (map-get? chain-events product-id))
```

### 4. VerificationContract
Allows third-party verifiers to attest to claims.

```clarity
;; verification-contract.clar
;; Handles third-party verifications of claims.

(define-map verifications uint (list 50 { verifier: principal, status: bool, comment: (string-ascii 256), timestamp: uint }))

(define-constant ERR-INVALID-CLAIM (err u400))
(define-constant MAX-VERIFICATIONS u50)

(define-public (verify-claim (product-id uint) (status bool) (comment (string-ascii 256)))
  (let ((verifs (default-to (list) (map-get? verifications product-id))))
    (asserts! (is-some (contract-call? .origin-claim get-claim product-id)) ERR-INVALID-CLAIM)
    (asserts! (< (len verifs) MAX-VERIFICATIONS) (err u401))
    (map-set verifications product-id (append verifs { verifier: tx-sender, status: status, comment: comment, timestamp: block-height }))
    (ok true)))

(define-read-only (get-verifications (product-id uint))
  (map-get? verifications product-id))

(define-read-only (is-verified (product-id uint))
  (let ((verifs (default-to (list) (map-get? verifications product-id))))
    (fold and-status verifs true)))

(define-private (and-status (verif { verifier: principal, status: bool, comment: (string-ascii 256), timestamp: uint }) (acc bool))
  (and acc (get status verif)))
```

### 5. CustomsIntegrator Contract
Integrates with customs APIs via oracles (stores oracle-fed data for compliance checks).

```clarity
;; customs-integrator.clar
;; Integrates oracle-fed customs data for compliance.

(define-map customs-data uint { tariff-code: (string-ascii 32), restrictions: (string-ascii 256), oracle-hash: (buff 32), updated-at: uint })

(define-data-var oracle-principal principal 'SP000000000000000000002Q6VF78) ;; Example oracle

(define-constant ERR-UNAUTHORIZED (err u500))
(define-constant ERR-INVALID-PRODUCT (err u501))

(define-public (update-customs-data (product-id uint) (tariff-code (string-ascii 32)) (restrictions (string-ascii 256)) (oracle-hash (buff 32)))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle-principal)) ERR-UNAUTHORIZED)
    (asserts! (is-some (contract-call? .product-registry get-product-info product-id)) ERR-INVALID-PRODUCT)
    (map-set customs-data product-id { tariff-code: tariff-code, restrictions: restrictions, oracle-hash: oracle-hash, updated-at: block-height })
    (ok true)))

(define-read-only (get-customs-data (product-id uint))
  (map-get? customs-data product-id))

(define-read-only (check-compliance (product-id uint))
  (let ((data (map-get? customs-data product-id)))
    (ok (is-none data)))) ;; Simplified; real logic would parse restrictions
```

### 6. GovernanceContract
Manages upgrades, oracle changes, and dispute resolutions.

```clarity
;; governance-contract.clar
;; Governance for system updates and disputes.

(define-data-var admin principal tx-sender)
(define-map disputes uint { product-id: uint, reason: (string-ascii 256), resolved: bool })

(define-constant ERR-UNAUTHORIZED (err u600))

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (contract-call? .customs-integrator var-set oracle-principal new-oracle)
    (ok true)))

(define-public (create-dispute (product-id uint) (reason (string-ascii 256)))
  (begin
    (map-set disputes product-id { product-id: product-id, reason: reason, resolved: false })
    (ok true)))

(define-public (resolve-dispute (dispute-id uint) (resolved bool))
  (let ((dispute (unwrap! (map-get? disputes dispute-id) (err u601))))
    (asserts! (is-eq tx-sender (var-get admin)) ERR-UNAUTHORIZED)
    (map-set disputes dispute-id (merge dispute { resolved: resolved }))
    (ok true)))

(define-read-only (get-dispute (dispute-id uint))
  (map-get? disputes dispute-id))
```

## Installation
1. Install Stacks CLI: `cargo install stacks-cli`.
2. Clone repo: `this repo`.
3. Deploy contracts: Use Clarinet or Stacks CLI to deploy each `.clar` file to testnet/mainnet.
4. Set up oracle: Integrate with a Stacks-compatible oracle service for customs API calls (e.g., fetch from https://api.cbp.gov).

## Usage
- **Register Product**: Call `register-product` on ProductRegistry.
- **Claim Origin**: Use OriginClaim to add claims.
- **Track Chain**: Add events via SupplyChainTracker.
- **Verify**: Third parties call VerificationContract.
- **Customs Check**: Oracle updates CustomsIntegrator; query for compliance.
- **Governance**: Admin handles updates/disputes.

## Contributing
Fork and PR. Ensure contracts are audited before production.

## License
MIT License.
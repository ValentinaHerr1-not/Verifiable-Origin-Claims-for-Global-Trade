(define-non-fungible-token product-batch uint)

(define-map product-metadata 
  uint 
  { 
    origin-country: (string-ascii 64), 
    description: (string-ascii 256), 
    manufacturer: principal, 
    category: (string-ascii 32), 
    batch-size: uint, 
    certification-hash: (buff 32), 
    created-at: uint 
  }
)

(define-map ownership-history 
  { product-id: uint, block: uint } 
  { 
    from: principal, 
    to: principal, 
    timestamp: uint 
  }
)

(define-data-var next-id uint u1)
(define-data-var max-products uint u10000)
(define-data-var mint-fee uint u500)
(define-data-var admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var authority-contract (optional principal) none)

(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-PAUSED (err u101))
(define-constant ERR-ALREADY-EXISTS (err u102))
(define-constant ERR-INVALID-COUNTRY (err u103))
(define-constant ERR-INVALID-DESCRIPTION (err u104))
(define-constant ERR-INVALID-CATEGORY (err u105))
(define-constant ERR-INVALID-BATCH-SIZE (err u106))
(define-constant ERR-INVALID-CERT-HASH (err u107))
(define-constant ERR-MAX-PRODUCTS-EXCEEDED (err u108))
(define-constant ERR-INVALID-FEE (err u109))
(define-constant ERR-NOT-ADMIN (err u110))
(define-constant ERR-AUTHORITY-NOT-SET (err u111))
(define-constant ERR-INVALID-TIMESTAMP (err u112))

(define-read-only (get-product-info (id uint))
  (map-get? product-metadata id)
)

(define-read-only (get-next-id)
  (ok (var-get next-id))
)

(define-read-only (is-paused)
  (var-get paused)
)

(define-read-only (get-mint-fee)
  (ok (var-get mint-fee))
)

(define-private (validate-country (country (string-ascii 64)))
  (if (and (> (len country) u0) (<= (len country) u64))
    (ok true)
    (err ERR-INVALID-COUNTRY)
  )
)

(define-private (validate-description (desc (string-ascii 256)))
  (if (and (> (len desc) u0) (<= (len desc) u256))
    (ok true)
    (err ERR-INVALID-DESCRIPTION)
  )
)

(define-private (validate-category (cat (string-ascii 32)))
  (if (or (is-eq cat "electronics") (is-eq cat "pharma") (is-eq cat "agri") (is-eq cat "luxury"))
    (ok true)
    (err ERR-INVALID-CATEGORY)
  )
)

(define-private (validate-batch-size (size uint))
  (if (and (> size u0) (<= size u1000000))
    (ok true)
    (err ERR-INVALID-BATCH-SIZE)
  )
)

(define-private (validate-cert-hash (hash (buff 32)))
  (if (is-eq (len hash) u32)
    (ok true)
    (err ERR-INVALID-CERT-HASH)
  )
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
    (ok true)
    (err ERR-INVALID-TIMESTAMP)
  )
)

(define-public (register-product 
  (origin-country (string-ascii 64)) 
  (description (string-ascii 256)) 
  (category (string-ascii 32)) 
  (batch-size uint) 
  (certification-hash (buff 32))
  (created-at uint)
)
  (let (
    (next (var-get next-id))
    (current-max (var-get max-products))
  )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (< next current-max) ERR-MAX-PRODUCTS-EXCEEDED)
    (try! (validate-country origin-country))
    (try! (validate-description description))
    (try! (validate-category category))
    (try! (validate-batch-size batch-size))
    (try! (validate-cert-hash certification-hash))
    (try! (validate-timestamp created-at))
    (try! (as-contract (contract-call? .stx-token transfer (var-get mint-fee) tx-sender (var-get admin) none)))
    (try! (nft-mint? product-batch next tx-sender))
    (map-set product-metadata next 
      { 
        origin-country: origin-country, 
        description: description, 
        manufacturer: tx-sender, 
        category: category, 
        batch-size: batch-size, 
        certification-hash: certification-hash, 
        created-at: created-at 
      }
    )
    (map-set ownership-history 
      { product-id: next, block: block-height } 
      { from: tx-sender, to: tx-sender, timestamp: block-height }
    )
    (var-set next-id (+ next u1))
    (print { event: "product-registered", id: next })
    (ok next)
  )
)

(define-public (transfer-product (id uint) (recipient principal))
  (let (
    (owner (unwrap! (nft-get-owner? product-batch id) ERR-UNAUTHORIZED))
  )
    (asserts! (is-eq owner tx-sender) ERR-UNAUTHORIZED)
    (try! (nft-transfer? product-batch id tx-sender recipient))
    (map-set ownership-history 
      { product-id: id, block: block-height } 
      { from: tx-sender, to: recipient, timestamp: block-height }
    )
    (print { event: "product-transferred", id: id, to: recipient })
    (ok true)
  )
)

(define-public (burn-product (id uint))
  (let (
    (owner (unwrap! (nft-get-owner? product-batch id) ERR-UNAUTHORIZED))
  )
    (asserts! (is-eq owner tx-sender) ERR-UNAUTHORIZED)
    (try! (nft-burn? product-batch id tx-sender))
    (map-delete product-metadata id)
    (print { event: "product-burned", id: id })
    (ok true)
  )
)

(define-public (set-pause (new-pause bool))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (var-set paused new-pause)
    (print { event: "pause-updated", paused: new-pause })
    (ok true)
  )
)

(define-public (set-mint-fee (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (asserts! (>= new-fee u0) ERR-INVALID-FEE)
    (var-set mint-fee new-fee)
    (print { event: "mint-fee-updated", fee: new-fee })
    (ok true)
  )
)

(define-public (set-max-products (new-max uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (asserts! (> new-max u0) ERR-INVALID-FEE)
    (var-set max-products new-max)
    (print { event: "max-products-updated", max: new-max })
    (ok true)
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (var-set admin new-admin)
    (print { event: "admin-updated", admin: new-admin })
    (ok true)
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (asserts! (is-none (var-get authority-contract)) ERR-AUTHORITY-NOT-SET)
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)
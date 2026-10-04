| flower | size | CPU ms p50 | E p50 | E / 165,000 |
|---|---|---|---|---|
| lean (handshake only), 5% | 133 | 0.15 | 144907 | 0.878 |
| learnable pattern, 50% | 160 | 0.18 | 140830 | 0.854 |
| RSA-512 signer, 50% | 378 | 0.95 | 107613 | 0.652 |
| RSA-1024 signer, 50% | 506 | 3.95 | 86757 | 0.526 |
| RSA-256 signer, 50% | 314 | 0.43 | 117568 | 0.713 |
| copy-key forger (RSA-512 public key, garbage signature), 5% | 325 | 0.21 | 116088 | 0.704 |
| whitewasher: fresh 512-bit DL key every call, 5% | 394 | 0.91 | 105259 | 0.638 |
| whitewasher: fresh 256-bit DL key every call, 5% | 330 | 0.45 | 115154 | 0.698 |
| replay forger (one recorded RSA-512 response in code), 5% | 468 | 0.16 | 94701 | 0.574 |

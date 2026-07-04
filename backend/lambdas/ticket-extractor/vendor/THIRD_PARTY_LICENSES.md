# Third-party code vendored into `ticket-extractor`

## `onlineticket.py`

- **Source**: https://github.com/rumpeltux/onlineticket
- **Commit**: `f4a956f4c1480b1e318a902327fad5f99b7956fd` (2024-04-02)
- **Vendored on**: 2026-06-11
- **License**: **GPLv3** (see `LICENSE.onlineticket`)
- **Purpose**: Parses the UIC 918.3 binary container embedded in DB Online-Ticket
  Aztec barcodes — extracts vorname, nachname, fahrkartennummer, fahrkartenpreis,
  start/zielbahnhof, abreisedatum, abfahrtszeit, ticket UID, etc.

### License implications

GPLv3 is copyleft. Practical impact for this project:

- **OK while running as a private Lambda**: GPL is triggered by *conveying*
  (= distributing) software. Operating a backend that uses GPL code internally
  is not conveyance — no source-disclosure obligation to end users.
- **NOT OK if we ever publish the Lambda zip / share the bundled source**: at
  that point the Lambda's own source must also be available under GPLv3.
- **AGPLv3 would be different** (network use = conveyance). This is plain GPLv3,
  so the loophole holds.

For the uni project scope this is fine. For any commercial / public release,
either:

1. Contact the author and request an MIT or dual license, or
2. Rewrite the UIC 918.3 parser ourselves from the public spec.

### How to update

```bash
git clone --depth 1 https://github.com/rumpeltux/onlineticket.git /tmp/ot
cp /tmp/ot/onlineticket.py ticket-extractor/vendor/onlineticket.py
cp /tmp/ot/LICENSE        ticket-extractor/vendor/LICENSE.onlineticket
# update the commit hash + date at the top of this file
```

### How it's used

The canonical usage example lives in `src/uic_918_3.py` — the wrapper
that translates UIC 918.3 block contents into RailBack schema fields.
Sketch:

```python
from vendor.onlineticket import OT

# `decoded_payload` is the bytes returned by zxing-cpp after reading
# the Aztec barcode out of the PDF/image. OT() never decodes Aztec
# itself — it consumes the already-decoded UIC 918.3 framing.
ot = OT(decoded_payload)

# Parsed blocks live under `.data['ticket']` as a list of DataBlock
# instances. Identify them by `__class__.__name__` (`OT_U_HEAD`,
# `OT_0080BL`, `OT_0080VU`, …); each carries a `.data` dict whose
# keys are the translated field names (`auftragsnummer`,
# `Vorname, Name`, `H-Start-Bf`, `preis`, …).
blocks = ot.data["ticket"]
```

See `src/uic_918_3.py` (the `parse_uic_918_3` function + the
`_block_data` helper) for the exact field-pick conventions and the
signature-validity gate.

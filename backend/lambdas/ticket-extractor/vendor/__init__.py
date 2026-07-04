"""Vendored third-party code (GPLv3-licensed `onlineticket.py`).

Marker package so `from vendor.onlineticket import OT` resolves both
under pytest (running from the lambda root) and inside the deployed
Lambda zip (where `vendor/` sits alongside `src/` at the package root).

See `THIRD_PARTY_LICENSES.md` for the GPLv3 attribution chain.
"""

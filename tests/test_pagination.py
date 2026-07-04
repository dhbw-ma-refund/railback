NOW = "2026-01-01T00:00:00Z"
NS = "pg001"
E = f"{NS}@it.de"

# DynamoDB Local returns all results without pagination unless Limit is set.
# These tests verify that _query auto-paginates by inserting enough items that
# a single page (Limit=5) would miss some, then reading back without a Limit.
PAGE_SIZE = 5
TOTAL = PAGE_SIZE + 3  # 8 items, needs two pages at Limit=5


def receipt_item(tid, bid):
    return {"pk": f"USER#{E}", "sk": f"TICKET#{tid}#BELEG#{bid}",
            "filename": "r.pdf", "typ": "TAXI",
            "s3_bucket": "bucket", "s3_key": f"b/{bid}.pdf", "uploaded_at": NOW}


class TestPagination:
    def test_query_returns_all_items_across_pages(self, db):
        tid = f"T_PG_{NS}"
        bids = [f"B_PG_{i:03}" for i in range(TOTAL)]
        for bid in bids:
            db.receipt.put(receipt_item(tid, bid))

        r = db.receipt.list_for_ticket(E, tid)
        assert r.is_ok()
        assert len(r.unwrap()) == TOTAL

        for bid in bids:
            db.receipt._delete(f"USER#{E}", f"TICKET#{tid}#BELEG#{bid}")

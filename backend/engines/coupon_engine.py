from typing import Optional

DELIVERY_FEE = 40.0
FREE_DELIVERY_THRESHOLD = 199.0
TAX_RATE = 0.05

COUPONS = {
    "WELCOME50": {"type": "flat", "value": 50, "min_order": 200, "description": "Flat ₹50 off on your order"},
    "SAVE10": {"type": "percent", "value": 10, "max_discount": 100, "min_order": 150, "description": "10% off, up to ₹100"},
    "FREESHIP": {"type": "freeship", "value": 0, "min_order": 99, "description": "Free delivery on your order"},
}

def list_coupons() -> list:
    return [{"code": code, **details} for code, details in COUPONS.items()]

def compute_order_totals(subtotal: float, coupon_code: Optional[str]) -> dict:
    discount = 0.0
    free_delivery = False
    error = None

    if coupon_code:
        coupon = COUPONS.get(coupon_code.upper())
        if not coupon:
            error = "Invalid coupon code."
        elif subtotal < coupon["min_order"]:
            error = f"This coupon needs a minimum order of ₹{coupon['min_order']}."
        elif coupon["type"] == "flat":
            discount = coupon["value"]
        elif coupon["type"] == "percent":
            discount = min(subtotal * coupon["value"] / 100, coupon.get("max_discount", subtotal))
        elif coupon["type"] == "freeship":
            free_delivery = True

    taxable = max(subtotal - discount, 0)
    delivery_fee = 0.0 if (free_delivery or taxable >= FREE_DELIVERY_THRESHOLD) else DELIVERY_FEE
    tax = round(taxable * TAX_RATE, 2)
    total = round(taxable + delivery_fee + tax, 2)

    return {
        "discount": round(discount, 2),
        "delivery_fee": delivery_fee,
        "tax": tax,
        "total": total,
        "error": error
    }

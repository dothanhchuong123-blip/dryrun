"""F5 tests: drop a file in the box, and the "not enough / not a business" gate. Fake router; tiny fixtures built here."""
import io
import logging

import httpx
import pytest
from PIL import Image
from pypdf import PdfWriter

from backend.agents.schemas import BusinessProfile, DocRead, InputCheck, ProfileParse
from backend.config import Settings
from backend.main import create_app
from backend.services.doc_reader import DocError, read_document, sniff
from backend.sim.analysis import MIN_LETTERS, is_empty_profile, letters_in, load_example
from backend.sim.offline import ScriptedRouter

PROFILE = BusinessProfile.model_validate(load_example("coffee_hcmc")["profile"])
OK = ProfileParse(check=InputCheck(verdict="ok", missing=[], reason=""), profile=PROFILE)
MARKER = "ZEBRA-MARKER-4417"


def text_pdf(text: str) -> bytes:
    stream = f"BT /F1 12 Tf 20 100 Td ({text}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offs)
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)


def png(size=(60, 40)) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", size, "white").save(b, "PNG")
    return b.getvalue()


def scan_pdf() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (200, 100), "white").save(b, "PDF")
    return b.getvalue()


def locked_pdf() -> bytes:
    w = PdfWriter()
    w.add_blank_page(100, 100)
    w.encrypt("secret")
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()


LONG_TEXT = f"Cafe Sao price list. Phin coffee 45,000 VND per cup. Beans 320,000 VND per kg. {MARKER}"


def vision_router(kind="price_list", text=LONG_TEXT):
    return ScriptedRouter({DocRead: [DocRead(text=text, kind=kind, language="en")] * 3, ProfileParse: [OK] * 3})


# --- doc_reader -------------------------------------------------------------------------------
async def test_pdf_with_text_layer_uses_no_model():
    router = ScriptedRouter()
    doc = await read_document(router, text_pdf(LONG_TEXT), "list.pdf")
    assert doc.method == "pdf_text" and "Phin coffee" in doc.text and doc.pages == 1 and not router.calls


async def test_scan_pdf_goes_to_vision():
    router = vision_router()
    doc = await read_document(router, scan_pdf(), "scan.pdf")
    assert doc.method == "vision" and router.calls[0][0] == "vision" and doc.kind == "price_list"


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
async def test_images_go_to_vision(fmt):
    b = io.BytesIO()
    Image.new("RGB", (3000, 1000), "white").save(b, fmt)
    seen = []
    router = vision_router()
    orig = router.call

    async def spy(tier, messages, *a, **kw):
        seen.append(messages[-1]["content"][1]["image_url"]["url"])
        return await orig(tier, messages, *a, **kw)

    router.call = spy
    doc = await read_document(router, b.getvalue(), "p")
    assert doc.method == "vision" and seen[0].startswith("data:image/jpeg;base64,")
    import base64

    img = Image.open(io.BytesIO(base64.b64decode(seen[0].split(",", 1)[1])))
    assert max(img.size) == 1600


async def test_text_file_is_read_as_text():
    doc = await read_document(ScriptedRouter(), b"item,price\ncoffee,45000\n", "x.csv")
    assert doc.method == "text" and "coffee,45000" in doc.text


async def test_sniff_ignores_names():
    assert sniff(b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 50) is None
    with pytest.raises(DocError) as e:
        await read_document(ScriptedRouter(), b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 50, "fake.pdf")
    assert e.value.status == 422 and "PDFs, photos" in e.value.reason


async def test_too_big_and_locked_and_pixel_bomb():
    with pytest.raises(DocError) as e:
        await read_document(ScriptedRouter(), b"%PDF-" + b"0" * (8 * 1024 * 1024), "big.pdf")
    assert e.value.status == 413
    with pytest.raises(DocError) as e:
        await read_document(ScriptedRouter(), locked_pdf(), "l.pdf")
    assert e.value.status == 422 and "password" in e.value.reason
    big = io.BytesIO()
    Image.new("1", (14000, 14000)).save(big, "PNG")  # 196M pixels, tiny file
    assert len(big.getvalue()) < 8 * 1024 * 1024
    with pytest.raises(DocError) as e:
        await read_document(ScriptedRouter(), big.getvalue(), "bomb.png")
    assert e.value.status == 422


# --- gate (pure) ------------------------------------------------------------------------------
def test_letters_in_ignores_links_emoji_digits():
    assert letters_in("🙂🙂 12345 !!!") == 0
    assert letters_in("see https://cafe.vn/menu now") == 6
    assert letters_in("I run a cafe") >= MIN_LETTERS and letters_in("hello") < MIN_LETTERS


def test_is_empty_profile_backstop():
    allg = ["price", "unit_cost", "weekly_sales", "lead_time_weeks", "stock_weeks", "rival_price", "exposed_cost_share"]
    assert is_empty_profile({"guessed_fields": allg, "product_unit": "Product"})
    assert is_empty_profile({"guessed_fields": allg, "product_unit": ""})
    assert not is_empty_profile({"guessed_fields": allg, "product_unit": "cup of coffee"})
    assert not is_empty_profile({"guessed_fields": allg[:-1], "product_unit": "item"})


# --- endpoints --------------------------------------------------------------------------------
def make(tmp_path, router):
    app = create_app(settings=Settings(_env_file=None), router=router, telemetry_dir=tmp_path / "tel", serve_frontend=False)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("1.2.3.4", 1)), base_url="http://t")


def files(data, name="a.pdf", ctype="application/pdf"):
    return {"file": (name, data, ctype)}


async def test_file_endpoint_pdf(tmp_path):
    router = vision_router()
    async with make(tmp_path, router) as c:
        r = await c.post("/api/profile/parse-file", files=files(text_pdf(LONG_TEXT)), data={"text": "my shop"})
    body = r.json()
    assert r.status_code == 200 and body["source"] == {"kind": "file", "name": "a.pdf", "method": "pdf_text", "pages": 1}
    assert [c[0] for c in router.calls] == ["super"]


async def test_file_endpoint_image_and_prompt_has_file_text(tmp_path):
    router = vision_router()
    sent = []
    orig = router.call

    async def spy(tier, messages, *a, **kw):
        sent.append((tier, messages))
        return await orig(tier, messages, *a, **kw)

    router.call = spy
    async with make(tmp_path, router) as c:
        r = await c.post("/api/profile/parse-file", files=files(png(), "p.png", "application/octet-stream"))
    assert r.status_code == 200 and r.json()["source"]["method"] == "vision"
    assert [t for t, _ in sent] == ["vision", "super"]
    assert "From their file p.png (price_list)" in sent[1][1][-1]["content"] and MARKER in sent[1][1][-1]["content"]


async def test_file_endpoint_bad_type_is_422(tmp_path):
    async with make(tmp_path, vision_router()) as c:
        r = await c.post("/api/profile/parse-file", files=files(b"MZ\x00\x00" + b"\x00" * 40, "x.pdf"))
    assert r.status_code == 422 and "PDFs, photos" in r.json()["reason"]


async def test_cat_photo_is_not_business_without_super_call(tmp_path):
    router = vision_router(kind="not_business", text="a cat on a sofa")
    async with make(tmp_path, router) as c:
        r = await c.post("/api/profile/parse-file", files=files(png(), "cat.png", "image/png"))
    j = r.json()
    assert r.status_code == 422 and j["code"] == "not_business" and "business" in j["reason"] and j["missing"] == []
    assert [c[0] for c in router.calls] == ["vision"]


async def test_file_text_never_reaches_logs(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    async with make(tmp_path, vision_router()) as c:
        await c.post("/api/profile/parse-file", files=files(text_pdf(LONG_TEXT)))
        await c.post("/api/profile/parse-file", files=files(scan_pdf()))
    assert MARKER not in caplog.text and "method=" in caplog.text


@pytest.mark.parametrize("text", ["", "🙂🙂🙂", "hello", "12345 !!!"])
async def test_layer_one_is_free_and_uncounted(tmp_path, text):
    router = ScriptedRouter()
    async with make(tmp_path, router) as c:
        for _ in range(7):  # more than the 5/hour limit: none of these count
            r = await c.post("/api/profile/parse", json={"text": text or " ", "url": None})
            if text:
                assert r.status_code == 422 and r.json()["code"] == "too_little" and r.json()["missing"]
    assert not router.calls


@pytest.mark.parametrize("verdict,missing", [("too_little", ["what_you_sell", "where"]), ("not_business", [])])
async def test_model_verdicts_are_422_with_code(tmp_path, verdict, missing):
    out = ProfileParse(check=InputCheck(verdict=verdict, missing=missing, reason="Because."), profile=None)
    router = ScriptedRouter({ProfileParse: [out]})
    async with make(tmp_path, router) as c:
        r = await c.post("/api/profile/parse", json={"text": "my shop does well and prices are fair"})
    assert r.status_code == 422 and r.json() == {"code": verdict, "reason": "Because.", "missing": missing}


async def test_rejections_count_toward_the_limit(tmp_path):
    out = ProfileParse(check=InputCheck(verdict="not_business", missing=[], reason="No."), profile=None)
    router = ScriptedRouter({ProfileParse: [out] * 6})
    async with make(tmp_path, router) as c:
        codes = [(await c.post("/api/profile/parse", json={"text": "grandma pho recipe"})).status_code for _ in range(6)]
    assert codes == [422] * 5 + [429]


async def test_ok_without_profile_is_502_and_generic_backstop_rejects(tmp_path):
    bad = ProfileParse(check=InputCheck(verdict="ok", missing=[], reason=""), profile=None)
    generic = PROFILE.model_copy(update={"product_unit": "product", "guessed_fields": [
        "price", "unit_cost", "weekly_sales", "lead_time_weeks", "stock_weeks", "rival_price", "exposed_cost_share"]})
    router = ScriptedRouter({ProfileParse: [bad, ProfileParse(check=OK.check, profile=generic)]})
    async with make(tmp_path, router) as c:
        assert (await c.post("/api/profile/parse", json={"text": "I run a shop here"})).status_code == 502
        r = await c.post("/api/profile/parse", json={"text": "I run a shop here"})
    assert r.status_code == 422 and r.json()["code"] == "too_little"


async def test_one_line_cafe_still_passes(tmp_path):
    async with make(tmp_path, ScriptedRouter({ProfileParse: [OK]})) as c:
        r = await c.post("/api/profile/parse", json={"text": "I run a café in Hanoi"})
    assert r.status_code == 200 and r.json()["profile"]["business_name"]

from app.detection.engine import Finding, scan_text


def test_scan_text_finds_pattern_match_with_line_number():
    text = "line one\nline two\naws_key = 'AKIAABCDEFGH12345678'\n"
    findings = scan_text(text)
    assert Finding("aws_access_key_id", "AKIAABCDEFGH12345678", 3) in findings


def test_scan_text_finds_high_entropy_token():
    token = "Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9"
    text = f"SECRET = '{token}'\n"
    findings = scan_text(text)
    assert any(f.secret_type == "generic_high_entropy" and f.secret_value == token for f in findings)


def test_scan_text_no_findings_on_clean_code():
    text = "def handler(request, response):\n    return {'status': 'ok'}\n"
    assert scan_text(text) == []


def test_scan_text_does_not_double_count_pattern_match_as_entropy_hit():
    text = "GITHUB_TOKEN = 'ghp_" + "a" * 36 + "'\n"
    findings = scan_text(text)
    types = [f.secret_type for f in findings]
    assert types.count("github_pat") == 1
    assert "generic_high_entropy" not in types

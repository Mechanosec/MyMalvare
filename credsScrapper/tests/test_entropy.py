from app.detection.entropy import (
    find_high_entropy_tokens,
    shannon_entropy,
)


def test_entropy_of_empty_string_is_zero():
    assert shannon_entropy("") == 0.0


def test_entropy_of_repeated_char_is_zero():
    assert shannon_entropy("aaaaaaaa") == 0.0


def test_entropy_of_random_looking_token_is_high():
    assert shannon_entropy("Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5b") > 4.0


def test_find_high_entropy_tokens_skips_short_tokens():
    assert find_high_entropy_tokens("short abc123") == []


def test_find_high_entropy_tokens_finds_random_looking_token():
    token = "Xk9pQ2mZ7vL4tR8wN1cJ6hF3sD0aY5bE9"
    hits = find_high_entropy_tokens(f"SECRET = '{token}'")
    assert token in hits


def test_find_high_entropy_tokens_skips_low_entropy_long_token():
    token = "a" * 40
    hits = find_high_entropy_tokens(f"PADDING = '{token}'")
    assert token not in hits

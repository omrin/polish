"""Test doubles shared by the account tests."""


class FakeTokenStore:
    def __init__(self, token: str | None = None):
        self.token = token

    def load(self):
        return self.token

    def save(self, token):
        self.token = token

    def clear(self):
        self.token = None

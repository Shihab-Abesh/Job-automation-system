"""Careers pages: a link is only a job if it looks like one. Offline."""
from __future__ import annotations

import pytest

from backend.sources.careers_page import CareersPageSource

PAGE = "https://acme.example/careers/"

HTML = """
<html><body>
  <a href="/careers/senior-qa-engineer">Senior QA Engineer</a>
  <a href="/jobs/1042">Business Development Executive</a>
  <a href="/apply/management-trainee-officer">Management Trainee Officer</a>
  <a href="/careers/">Engineering</a>
  <a href="/software-testing-as-service">QA Testing &amp; Automation</a>
  <a href="/adobe-experience-manager-aem/">Adobe Experience Manager</a>
  <a href="/data-engineering-services">Data Engineering</a>
  <a href="/uilm">Blocks Language Manager</a>
  <a href="/about">About our engineers</a>
</body></html>
"""


class StubFetcher:
    def get(self, url):
        return HTML


def _jobs():
    source = CareersPageSource(StubFetcher(), {"sites": [{"company": "Acme", "url": PAGE}]})
    return [(j.title, j.url) for j in source.collect([])]


def test_only_real_postings_are_returned():
    assert _jobs() == [
        ("Senior QA Engineer", "https://acme.example/careers/senior-qa-engineer"),
        ("Business Development Executive", "https://acme.example/jobs/1042"),
        ("Management Trainee Officer", "https://acme.example/apply/management-trainee-officer"),
    ]


@pytest.mark.parametrize("title,link", [
    ("Engineering", PAGE),                                            # a department, and the page itself
    ("QA Testing & Automation", "https://acme.example/software-testing-as-service"),   # a service
    ("Adobe Experience Manager", "https://acme.example/adobe-experience-manager-aem/"),  # a product
    ("Blocks Language Manager", "https://acme.example/uilm"),
    ("Marketing Manager", "https://acme.example/about-us"),           # role word, but not a job address
])
def test_marketing_pages_are_not_mistaken_for_jobs(title, link):
    assert CareersPageSource._looks_like_a_job(title, link, PAGE) is False

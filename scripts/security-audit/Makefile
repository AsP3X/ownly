# Human: Convenience targets for security audit scripts.
# Agent: invokes sec001 script and unittest discover.

BASE_URL ?= http://127.0.0.1:8080

.PHONY: sec001 test sec001-json sec001-quiet

sec001:
	python3 sec001_setup_info_disclosure.py --base-url $(BASE_URL)

sec001-json:
	python3 sec001_setup_info_disclosure.py --base-url $(BASE_URL) --json

sec001-quiet:
	python3 sec001_setup_info_disclosure.py --base-url $(BASE_URL) --quiet

test:
	python3 -m unittest discover -s tests -v

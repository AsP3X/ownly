# Human: Convenience targets for security audit scripts.
# Agent: invokes sec001 script and unittest discover.

BASE_URL ?= http://127.0.0.1:8080

.PHONY: sec001 sec002 sec003 sec004 sec005 sec006 sec007 sec008 test sec001-json sec001-quiet sec002-json sec002-quiet sec003-json sec004-json sec005-json sec006-json sec007-json sec008-json

sec001:
	python3 sec001_setup_info_disclosure.py --base-url $(BASE_URL)

sec002:
	@echo "SEC002 requires SEC002_SUBJECT_* and SEC002_DEMOTER_* credentials"
	python3 sec002_stale_jwt_admin_role.py --base-url $(BASE_URL)

sec001-json:
	python3 sec001_setup_info_disclosure.py --base-url $(BASE_URL) --json

sec001-quiet:
	python3 sec001_setup_info_disclosure.py --base-url $(BASE_URL) --quiet

sec002-json:
	python3 sec002_stale_jwt_admin_role.py --base-url $(BASE_URL) --json

sec002-quiet:
	python3 sec002_stale_jwt_admin_role.py --base-url $(BASE_URL) --quiet

sec003:
	@echo "SEC003 requires SEC003_OWNER_EMAIL and SEC003_OWNER_PASSWORD"
	python3 sec003_public_share_soft_delete.py --base-url $(BASE_URL)

sec003-json:
	python3 sec003_public_share_soft_delete.py --base-url $(BASE_URL) --json

sec004:
	@echo "SEC004 requires SEC004_OWNER_EMAIL and SEC004_OWNER_PASSWORD"
	python3 sec004_authenticated_trash_download.py --base-url $(BASE_URL)

sec004-json:
	python3 sec004_authenticated_trash_download.py --base-url $(BASE_URL) --json

sec005:
	python3 sec005_setup_bootstrap_race.py --base-url $(BASE_URL)

sec005-json:
	python3 sec005_setup_bootstrap_race.py --base-url $(BASE_URL) --json

sec006:
	python3 sec006_rate_limit_forwarded_headers.py --base-url $(BASE_URL)

sec006-json:
	python3 sec006_rate_limit_forwarded_headers.py --base-url $(BASE_URL) --json

sec007:
	@echo "SEC007 requires SEC007_OWNER_EMAIL and SEC007_OWNER_PASSWORD"
	python3 sec007_share_overview_password_bypass.py --base-url $(BASE_URL)

sec007-json:
	python3 sec007_share_overview_password_bypass.py --base-url $(BASE_URL) --json

sec008:
	python3 sec008_setup_storage_ssrf.py --base-url $(BASE_URL)

sec008-json:
	python3 sec008_setup_storage_ssrf.py --base-url $(BASE_URL) --json

test:
	python3 -m unittest discover -s tests -v

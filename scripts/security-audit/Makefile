# Human: Convenience targets for security audit scripts.
# Agent: invokes sec001 script and unittest discover.

BASE_URL ?= http://127.0.0.1:8080

# Prefer the venv created by scripts/setup-test-env.sh (or .bat) so normal
# contributors don't need a global python3 with the right packages.
# (scripts/.venv from the Makefile's perspective is ../.venv)
ifneq (,$(wildcard ../.venv/bin/python))
PYTHON := ../.venv/bin/python
else ifneq (,$(wildcard ../.venv/Scripts/python.exe))
PYTHON := ../.venv/Scripts/python.exe
else
PYTHON ?= python3
endif

.PHONY: sec001 sec002 sec003 sec004 sec005 sec006 sec007 sec008 sec009 sec010 sec011 sec012 test sec001-json sec001-quiet sec002-json sec002-quiet sec003-json sec004-json sec005-json sec006-json sec007-json sec008-json sec009-json sec010-json sec011-json sec012-json

sec001:
	$(PYTHON) sec001_setup_info_disclosure.py --base-url $(BASE_URL)

sec002:
	@echo "SEC002 requires SEC002_SUBJECT_* and SEC002_DEMOTER_* credentials"
	$(PYTHON) sec002_stale_jwt_admin_role.py --base-url $(BASE_URL)

sec001-json:
	$(PYTHON) sec001_setup_info_disclosure.py --base-url $(BASE_URL) --json

sec001-quiet:
	$(PYTHON) sec001_setup_info_disclosure.py --base-url $(BASE_URL) --quiet

sec002-json:
	$(PYTHON) sec002_stale_jwt_admin_role.py --base-url $(BASE_URL) --json

sec002-quiet:
	$(PYTHON) sec002_stale_jwt_admin_role.py --base-url $(BASE_URL) --quiet

sec003:
	@echo "SEC003 requires SEC003_OWNER_EMAIL and SEC003_OWNER_PASSWORD"
	$(PYTHON) sec003_public_share_soft_delete.py --base-url $(BASE_URL)

sec003-json:
	$(PYTHON) sec003_public_share_soft_delete.py --base-url $(BASE_URL) --json

sec004:
	@echo "SEC004 requires SEC004_OWNER_EMAIL and SEC004_OWNER_PASSWORD"
	$(PYTHON) sec004_authenticated_trash_download.py --base-url $(BASE_URL)

sec004-json:
	$(PYTHON) sec004_authenticated_trash_download.py --base-url $(BASE_URL) --json

sec005:
	$(PYTHON) sec005_setup_bootstrap_race.py --base-url $(BASE_URL)

sec005-json:
	$(PYTHON) sec005_setup_bootstrap_race.py --base-url $(BASE_URL) --json

sec006:
	$(PYTHON) sec006_rate_limit_forwarded_headers.py --base-url $(BASE_URL)

sec006-json:
	$(PYTHON) sec006_rate_limit_forwarded_headers.py --base-url $(BASE_URL) --json

sec007:
	@echo "SEC007 requires SEC007_OWNER_EMAIL and SEC007_OWNER_PASSWORD"
	$(PYTHON) sec007_share_overview_password_bypass.py --base-url $(BASE_URL)

sec007-json:
	$(PYTHON) sec007_share_overview_password_bypass.py --base-url $(BASE_URL) --json

sec008:
	$(PYTHON) sec008_setup_storage_ssrf.py --base-url $(BASE_URL)

sec008-json:
	$(PYTHON) sec008_setup_storage_ssrf.py --base-url $(BASE_URL) --json

sec009:
	@echo "SEC009 requires SEC009_OWNER_EMAIL and SEC009_OWNER_PASSWORD"
	$(PYTHON) sec009_share_password_bruteforce.py --base-url $(BASE_URL)

sec009-json:
	$(PYTHON) sec009_share_password_bruteforce.py --base-url $(BASE_URL) --json

sec010:
	$(PYTHON) sec010_setup_database_ssrf.py --base-url $(BASE_URL)

sec010-json:
	$(PYTHON) sec010_setup_database_ssrf.py --base-url $(BASE_URL) --json

sec011:
	@echo "SEC011 requires SEC011_OWNER_EMAIL and SEC011_OWNER_PASSWORD"
	$(PYTHON) sec011_trash_zip_download.py --base-url $(BASE_URL)

sec011-json:
	$(PYTHON) sec011_trash_zip_download.py --base-url $(BASE_URL) --json

sec012:
	@echo "SEC012 requires --confirm-exploit (destructive on fresh DB)"
	$(PYTHON) sec012_unauthenticated_admin_creation.py --base-url $(BASE_URL) --confirm-exploit

sec012-json:
	$(PYTHON) sec012_unauthenticated_admin_creation.py --base-url $(BASE_URL) --confirm-exploit --json

test:
	$(PYTHON) -m unittest discover -s tests -v

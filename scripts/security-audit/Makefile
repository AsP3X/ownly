# Human: Convenience targets for security audit scripts.
# Agent: invokes sec001 script and unittest discover.

BASE_URL ?= http://127.0.0.1:8080

.PHONY: sec001 sec002 sec003 sec004 test sec001-json sec001-quiet sec002-json sec002-quiet sec003-json sec004-json

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

test:
	python3 -m unittest discover -s tests -v

TAURI_SRC_DIR=./src-tauri
TAURI_TARGET_DIR=$(TAURI_SRC_DIR)/target
FE_SRC_DIR=./src

install:
	cd $(FE_SRC_DIR) && yarn install

dev:
	cd $(TAURI_SRC_DIR) && yarn tauri dev

lint:
	cd $(TAURI_SRC_DIR) && cargo clippy --workspace --all-targets --all-features

clean:
	rm -rf $(TAURI_TARGET_DIR)

test:
	cd $(TAURI_SRC_DIR) && cargo test

check:
	cd $(TAURI_SRC_DIR) && cargo check --workspace --all-targets --all-features

version:
	@python3 script/bump_version.py "$(firstword $(filter-out $@,$(MAKECMDGOALS)))"

# Ignore all non-targets
%:
	@:

.PHONY: install dev lint clean test version check

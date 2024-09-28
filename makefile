TAURI_SRC_DIR=./src-tauri
TAURI_TARGET_DIR=$(TAURI_SRC_DIR)/target
FE_SRC_DIR=./src

install:
	cd $(FE_SRC_DIR) && yarn install

dev:
	cd $(TAURI_SRC_DIR) && yarn tauri dev

clean:
	rm -rf $(TAURI_TARGET_DIR)

test:
	cd $(TAURI_SRC_DIR) && cargo test

.PHONY: install dev clean test

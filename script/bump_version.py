#!/usr/bin/env python3
import json
import re
import sys
import os

def update_package_json(version):
    """Update version in package.json"""
    package_json_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'package.json')
    
    with open(package_json_path, 'r') as f:
        data = json.load(f)
    
    old_version = data['version']
    data['version'] = version
    
    with open(package_json_path, 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"Updated package.json: {old_version} -> {version}")

def update_cargo_toml(version):
    """Update version in src-tauri/Cargo.toml"""
    cargo_toml_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'src-tauri', 'Cargo.toml')
    
    with open(cargo_toml_path, 'r') as f:
        lines = f.readlines()
    
    in_package_section = False
    old_version = None
    
    for i, line in enumerate(lines):
        # Check if we're entering the [package] section
        if line.strip() == '[package]':
            in_package_section = True
            continue
        
        # Check if we're leaving the [package] section
        if in_package_section and line.strip().startswith('['):
            in_package_section = False
            continue
        
        # Only update version in [package] section
        if in_package_section and line.strip().startswith('version = '):
            old_version = line.strip().split('"')[1]
            lines[i] = f'version = "{version}"\n'
            break
    
    if old_version is None:
        raise Exception("Could not find version in [package] section of Cargo.toml")
    
    with open(cargo_toml_path, 'w') as f:
        f.writelines(lines)
    
    print(f"Updated src-tauri/Cargo.toml: {old_version} -> {version}")

def update_tauri_conf(version):
    """Update version in src-tauri/tauri.conf.json"""
    tauri_conf_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'src-tauri', 'tauri.conf.json')
    
    with open(tauri_conf_path, 'r') as f:
        data = json.load(f)
    
    old_version = data['version']
    data['version'] = version
    
    with open(tauri_conf_path, 'w') as f:
        json.dump(data, f, indent=2)
    
    print(f"Updated src-tauri/tauri.conf.json: {old_version} -> {version}")

def validate_version(version):
    """Validate semantic version format"""
    pattern = r'^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$'
    if not re.match(pattern, version):
        print(f"Error: Invalid version format '{version}'. Expected semantic version like '1.2.3' or '1.2.3-beta.1'")
        return False
    return True

def main():
    if len(sys.argv) != 2:
        print("Usage: python bump_version.py <new_version>")
        print("Example: python bump_version.py 2.0.6")
        sys.exit(1)
    
    new_version = sys.argv[1]
    
    if not validate_version(new_version):
        sys.exit(1)
    
    try:
        update_package_json(new_version)
        update_cargo_toml(new_version)
        update_tauri_conf(new_version)
        print("\nAll files updated successfully!")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

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
        if line.strip() == '[package]':
            in_package_section = True
            continue
        
        if in_package_section and line.strip().startswith('['):
            in_package_section = False
            continue
        
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

def update_website_htmls(version):
    """Update version in website/index.html and website/en.html"""
    repo_root = os.path.dirname(os.path.dirname(__file__))

    for filename in ['index.html', 'en.html']:
        html_path = os.path.join(repo_root, 'website', filename)

        with open(html_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Match: <p class="price-amount">vX.Y.Z(-suffix)?</p>
        pattern = r'(<p class="price-amount">)v[\d]+\.[\d]+\.[\d]+(-[a-zA-Z0-9.]+)?(</p>)'
        match = re.search(pattern, content)

        if match:
            old_ver = match.group(0)
            new_ver = f'{match.group(1)}v{version}{match.group(3)}'
            content = content.replace(old_ver, new_ver)

            old_ver_num = re.search(r'v([\d.]+)', old_ver).group(1)

            print(f"Updated website/{filename}: {old_ver_num} -> {version}")
        else:
            print(f"Warning: Could not find version in website/{filename}")
            old_ver_num = '?'

        # Match: class="version-link" ... >vX.Y.Z</a> (eyebrow section)
        pattern2 = r'(class="version-link"[^>]*>)v[\d]+\.[\d]+\.[\d]+(-[a-zA-Z0-9.]+)?(</a>)'
        match2 = re.search(pattern2, content)

        if match2:
            old_ver2 = match2.group(0)
            new_ver2 = f'{match2.group(1)}v{version}{match2.group(3)}'
            content = content.replace(old_ver2, new_ver2)
            old_ver2_num = re.search(r'v([\d.]+)', old_ver2).group(1)
            print(f"Updated website/{filename} (version-link): {old_ver2_num} -> {version}")

        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(content)

def update_readme(version):
    """Update version strings in README.md"""
    readme_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'README.md')

    with open(readme_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find old version from the first download link
    match = re.search(r'SJTU\.Canvas\.Helper_(\d+\.\d+\.\d+)_x64_en-US\.msi', content)
    if not match:
        print("Warning: Could not find current version in README.md")
        return

    old_version = match.group(1)

    old_count = 0

    # Update GitHub release URL paths
    if f'app-v{old_version}' in content:
        old_count += content.count(f'app-v{old_version}')
        content = content.replace(f'app-v{old_version}', f'app-v{version}')

    # Update filenames: SJTU.Canvas.Helper_X.Y.Z_*
    if f'Helper_{old_version}_' in content:
        old_count += content.count(f'Helper_{old_version}_')
        content = content.replace(f'Helper_{old_version}_', f'Helper_{version}_')

    # Update filenames: SJTU.Canvas.Helper-X.Y.Z-*
    if f'Helper-{old_version}-' in content:
        old_count += content.count(f'Helper-{old_version}-')
        content = content.replace(f'Helper-{old_version}-', f'Helper-{version}-')

    # Update portable zip: Helper_v_X.Y.Z_*
    if f'_v_{old_version}_' in content:
        old_count += content.count(f'_v_{old_version}_')
        content = content.replace(f'_v_{old_version}_', f'_v_{version}_')

    with open(readme_path, 'w', encoding='utf-8') as f:
        f.write(content)

    if old_count > 0:
        print(f"Updated README.md: {old_version} -> {version} ({old_count} replacements)")
    else:
        print(f"Warning: No version patterns found to replace in README.md")

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
        update_website_htmls(new_version)
        update_readme(new_version)
        print("\nAll files updated successfully!")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

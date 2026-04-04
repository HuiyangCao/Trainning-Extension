const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const CONTRIBUTES_DIR = path.join(ROOT, 'contributes');

function mergeContributes() {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf-8'));

    // Read all JSON files from contributes directory
    const files = fs.readdirSync(CONTRIBUTES_DIR).filter(f => f.endsWith('.json'));

    for (const file of files) {
        const filePath = path.join(CONTRIBUTES_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Merge commands
        if (data.commands) {
            pkg.contributes.commands.push(...data.commands);
        }

        // Merge viewsContainers (if any)
        if (data.viewsContainers) {
            for (const [container, items] of Object.entries(data.viewsContainers)) {
                if (!pkg.contributes.viewsContainers[container]) {
                    pkg.contributes.viewsContainers[container] = [];
                }
                pkg.contributes.viewsContainers[container].push(...items);
            }
        }

        // Merge views
        if (data.views) {
            for (const [container, items] of Object.entries(data.views)) {
                if (!pkg.contributes.views[container]) {
                    pkg.contributes.views[container] = [];
                }
                pkg.contributes.views[container].push(...items);
            }
        }

        // Merge menus
        if (data.menus) {
            for (const [menu, items] of Object.entries(data.menus)) {
                if (!pkg.contributes.menus[menu]) {
                    pkg.contributes.menus[menu] = [];
                }
                pkg.contributes.menus[menu].push(...items);
            }
        }

        // Merge keybindings
        if (data.keybindings) {
            pkg.contributes.keybindings.push(...data.keybindings);
        }
    }

    // Write back to package.json
    fs.writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n');
    console.log('✓ Merged', files.length, 'contribute files into package.json');
}

mergeContributes();

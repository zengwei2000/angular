#!/usr/bin/env node

import child_process from 'child_process';
import esbuild from 'esbuild';
import fs from 'fs';
import glob from 'glob';
import {dirname, join, relative} from 'path';
import url from 'url';
import multimatch from 'multimatch';



const containingDir = dirname(url.fileURLToPath(import.meta.url));
const projectDir = join(containingDir, '../../');
const legacyTsconfigPath = join(projectDir, 'packages/tsconfig-legacy-saucelabs.json');

const distDir = join(projectDir, 'dist/');
const nodeModulesDir = join(projectDir, 'node_modules/');
const outFile = join(distDir, 'legacy-test-bundle.spec.js');
const tscBinFile = join(nodeModulesDir, '.bin/tsc');
//const ngcBinFile = join(distDir, 'bin/packages/compiler-cli/npm_package/bundles/src/bin/ngc.js');
const legacyOutputDir = join(distDir, 'all/@angular');

/**
 * This script builds the whole library in `angular/components` together with its
 * spec files into a single IIFE bundle.
 *
 * The bundle can then be used in the legacy Saucelabs or Browserstack tests. Bundling
 * helps with running the Angular linker on framework packages, and also avoids unnecessary
 * complexity with maintaining module resolution at runtime through e.g. SystemJS.
 */
async function main() {

  // Build the project with Ngtsc so that external resources are inlined.
  await compileProject();

  const specEntryPointFile = await createEntryPointSpecFile();
  const esbuildResolvePlugin = await createResolveEsbuildPlugin();

  const result = await esbuild.build({
    bundle: true,
    sourceRoot: projectDir,
    platform: 'browser',
    format: 'iife',
    keepNames: true,
    outfile: outFile,
    plugins: [esbuildResolvePlugin],
    stdin: {contents: specEntryPointFile, resolveDir: projectDir},
  });


  if (result.errors.length) {
    throw Error('Could not build legacy test bundle. See errors above.');
  }

  const contents = fs.readFileSync(outFile, {encoding: 'utf8'});
  fs.writeFileSync(outFile, contents.replaceAll('$rootScope2', '$rootScope'));
}

async function compileProject() {
  // Build the project with Ngtsc so that external resources are inlined.
  const ngcProcess = child_process.spawnSync(
    'node',
    [tscBinFile, '--project', legacyTsconfigPath],
    {shell: true, stdio: 'inherit'},
  );

  if (ngcProcess.error || ngcProcess.status !== 0) {
    throw Error('Unable to compile tests and library. See error above.');
  }
}


/**
 * Queries for all spec files in the built output and creates a single
 * ESM entry-point file which imports all the spec files.
 *
 * This spec file can then be used as entry-point for ESBuild in order
 * to bundle all specs in an IIFE file.
 */
async function createEntryPointSpecFile() {
  let testFiles = glob.sync('**/*_spec.js', {absolute: true, cwd: legacyOutputDir});
  
  testFiles = multimatch(testFiles, [
    `${legacyOutputDir}/**/*_spec.js`,
    `!${legacyOutputDir}/**/benchpress/**/*.js`,
    `!${legacyOutputDir}/**/elements/**/*.js`,
    `!${legacyOutputDir}/**/compiler-cli/test/diagnostics/**`,
    `!${legacyOutputDir}/**/_testing_init/**/*.js`,
    `!${legacyOutputDir}/**/**/e2e_test/**/*.js`,
    `!${legacyOutputDir}/**/**/*node_only_spec.js`,
    `!${legacyOutputDir}/**/compiler-cli/**/*.js`,
    `!${legacyOutputDir}/**/compiler-cli/src/ngtsc/**/*.js`,
    `!${legacyOutputDir}/**/compiler-cli/test/compliance/**/*.js`,
    `!${legacyOutputDir}/**/compiler-cli/test/ngtsc/**/*.js`,
    `!${legacyOutputDir}/**/compiler/test/aot/**/*.js`,
    `!${legacyOutputDir}/**/compiler/test/render3/**/*.js`,
    `!${legacyOutputDir}/**/core/test/bundling/**/*.js`,
    `!${legacyOutputDir}/**/core/test/render3/ivy/**/*.js`,
    `!${legacyOutputDir}/**/core/test/render3/jit/**/*.js`,
    `!${legacyOutputDir}/**/core/test/render3/perf/**/*.js`,
    `!${legacyOutputDir}/**/elements/schematics/*.js`,
    `!${legacyOutputDir}/**/examples/**/e2e_test/*.js`,
    `!${legacyOutputDir}/**/language-service/**/*.js`,
    `!${legacyOutputDir}/**/localize/**/test/**/*.js`,
    `!${legacyOutputDir}/**/localize/schematics/**/*.js`,
    `!${legacyOutputDir}/**/router/**/test/**/*.js`,
    `!${legacyOutputDir}/**/platform-browser/testing/e2e_util.js`,
  ]);


  let specEntryPointFile = `import './scripts/ci/angular-test-init-spec.ts';`;
  let i = 0;
  const testNamespaces = [];

  for (const file of testFiles) {
    const relativePath = relative(projectDir, file);
    const specifier = `./${relativePath.replace(/\\/g, '/')}`;
    const testNamespace = `__${i++}`;

    testNamespaces.push(testNamespace);
    specEntryPointFile += `import * as ${testNamespace} from '${specifier}';\n`;
  }

  for (const namespaceId of testNamespaces) {
    // We generate a side-effect invocation that references the test import. This
    // is necessary to trick `ESBuild` in preserving the imports. Unfortunately the
    // test files would be dead-code eliminated otherwise because the specs are part
    // of folders with `package.json` files setting the `"sideEffects: false"` field.
    specEntryPointFile += `new Function('x', 'return x')(${namespaceId});\n`;
  }

  return specEntryPointFile;
}

/**
 * Creates an ESBuild plugin which maps `@angular/<..>` module names to their
 * locally-built output (for the packages which are built as part of this repo).
 */
async function createResolveEsbuildPlugin() {
  return {
    name: 'ng-resolve-esbuild',
    setup: build => {
      build.onResolve({filter: /^angular\-in\-memory\-web\-api/}, async args => {
        return {path: join(legacyOutputDir, 'misc/angular-in-memory-web-api/index.js')};
      });
      
      build.onResolve({filter: /es5_downleveled_inheritance_fixture$/}, async args => {
        return {path: join(distDir, 'bin/packages/core/test/reflection/es5_downleveled_inheritance_fixture.js')};
      });
      
      build.onResolve({filter: /^@angular\/core\/src\/change_detection\/differs\/default_keyvalue_differ/}, async args => {
        return {path: join(legacyOutputDir, 'core/src/change_detection/differs/default_keyvalue_differ.js')};
      });

      build.onResolve({filter: /^@angular\/core\/src\/metadata/}, async args => {
        return {path: join(legacyOutputDir, 'core/src/metadata.js')};
      });

      build.onResolve({filter: /^@angular\/core\/src\/change_detection\/change_detection_util/}, async args => {
        return {path: join(legacyOutputDir, 'core/src/change_detection/change_detection_util.js')};
      });

      build.onResolve({filter: /^@angular\/core\/src\/change_detection/}, async args => {
        return {path: join(legacyOutputDir, 'core/src/change_detection/change_detection.js')};
      });
      
      build.onResolve({filter: /^@angular\/core\/src\/zone/}, async args => {
        return {path: join(legacyOutputDir, 'core/src/zone/ng_zone.js')};
      });

      build.onResolve({filter: /^@angular/}, async args => {
          const pkgName = args.path.substr('@angular/'.length);
          let resolvedPath = join(legacyOutputDir, pkgName);
          let stats = await statGraceful(resolvedPath);

          // If the resolved path points to a directory, resolve the contained `index.js` file
          if (stats && stats.isDirectory()) {
            resolvedPath = join(resolvedPath, 'index.js');
            stats = await statGraceful(resolvedPath);
          }
          // If the resolved path does not exist, check with an explicit JS extension.
          else if (stats === null) {
            resolvedPath += '.js';
            stats = await statGraceful(resolvedPath);
          }

          return stats !== null ? {path: resolvedPath} : undefined;
        });

      for (const importPath in ['domino', 'url', 'xhr2', '@angular/platform-server/src/domino_adapter']) {
        build.onResolve({filter: /domino/}, async args => {
          return {path: join(legacyOutputDir, 'empty.js')};
        });
      }
    },
  };
}

/**
 * Retrieves the `fs.Stats` results for the given path gracefully.
 * If the file does not exist, returns `null`.
 */
async function statGraceful(path) {
  try {
    return await fs.promises.stat(path);
  } catch {
    return null;
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});

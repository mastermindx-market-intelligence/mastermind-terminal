# Generated-controller Python loader repair

## Problem and change

The generated-controller qualification deliberately starts a child with a small environment allowlist. On the original self-hosted runner, the selected setup-python 3.12.16 executable has a RUNPATH pointing at the hosted-toolcache layout. Removing its configured LD_LIBRARY_PATH causes the relocated binary to load the system libpython3.12.3 while using the selected3.12.16 standard library. The actual companion suite then crashes in json.dumps during test_reporting_workflow_does_not_receive_native_user_credentials.

The only product-code-adjacent change is in tests/test_trusted_migration_ownership.py: retain LD_LIBRARY_PATH exactly when the parent explicitly supplies it. The existing temporary HOME, restricted PATH, installed-test-dependency PYTHONPATH, disabled plugin autoload, bytecode setting, network-denial prelude, exact executable and complete JUnit assertions remain. No workflow, migration authority, runner registration, credential, cache policy or status rule changes.

Protected base: b6db0ca0ebfba1463746dc1eb6bdd6b50f4e19e7, tree6971516465096849a2edbf449a8589bd3ea23a7e.
Original test blob:4f846e3b37310f830b919576d8fa0206ac49bc5f.
Repaired test blob:f05ff0062e7629d67e9864e30ceb3db50b3b748a; SHA25671744f2cff6e041d93dff90a9ded8a670525acf1b83b22c6c2360614b8dcd869.

## Actual consumer verification

On the original affected host, mastermind-pc, a fresh isolated environment was derived from the same verified cache binary:
`/home/longr/actions-runner-a/_work/_tool/Python/3.12.16/x64/bin/python`,
SHA256a9daa2903823e8bc0ce562bcf07be5a9ae27cf5d9d6dccf492438f0a310c0982.

This is a controlled reproduction; the failed CI job's original temporary venv and fixture had already been deleted. The retained bundle records16 protected files, with only the owned candidate test overlaid. Dependencies are pytest9.2.0 and PyYAML6.0.3; the exact resolved versions and command receipts are in linux-proof/evidence/execution.json.

| Check | Result |
| --- | --- |
| Stripped child environment | Python3.12.3, system libpython |
| Repaired child environment | Python3.12.16, selected cache libpython |
| Original source, real generated consumer | Failed with the same segmentation fault in json.dumps / reporting-workflow credential test |
| Repaired source, same real generated consumer | Parent1 case passed; all189 generated controller cases passed; zero failures/errors/skips |
| Full ownership suite on M2 | 157 passed; generated companion189 cases also clean |

The Linux source bundle SHA256 is12853133290888bfa9ca67e6abfeba07764fedf8edf64ff2c994a5bfd3114a4b. The imported Linux proof archive is8,032 bytes, SHA25652f06f30cf9f9bf7dd21dfb4bcca8912adb3d125cd1cf10ef34704c08a3ee53a. Its raw logs, parent and companion JUnit files, source manifest and runtime identity were verified after transfer. Core dumps were disabled only for the controlled reproduction process.

## Evidence and scope

- source.json and the original source preimage bind the one-file repair.
- ownership-suite.log / ownership-suite.xml / generated-controller.xml record the M2 run.
- linux-source-bundle.tar.gz and linux-bundle-manifest.json bind unchanged protected inputs and the candidate.
- linux-proof.tar.gz plus its expanded linux-proof/ directory preserve the actual Linux results.
- linux-import.json records archive verification and parsed JUnit case counts.

The estate's existing#1461 retry and queue entry are separate. Its hosted rerun passed, but that did not repair this relocated-interpreter mismatch. This follow-up changes no#1461 lane or host-registration source. The only open-PR file overlap found was#1312's PYTHONPATH addition, which is already contained in this protected base; its migration0051/release holds remain on that PR.

Authority: the Chairman's Terminal estate repair assignment, parent Mastermind#2028; managed operation terminal-python-loader-support-20261111-c3; law pinbb2c2e4437e6ee250f9d4ee9b6b420abdfbbc178. Required native CI/merge-group controls still govern integration.

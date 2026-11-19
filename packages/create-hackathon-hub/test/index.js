// Node 22 and later read `node --test <dir>` as a file path rather than a
// folder to search, and resolve it to this index. Importing the suites here
// keeps `node --test packages/create-hackathon-hub/test/` working everywhere.
import "./create.test.mjs";

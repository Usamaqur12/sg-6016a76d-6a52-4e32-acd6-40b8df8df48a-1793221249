import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = ["src/pages", "src/components"];
const files = roots.flatMap(walk).filter((file) => /\.(tsx|jsx)$/.test(file) && !file.includes(`${path.sep}components${path.sep}ui${path.sep}`));
let findings = 0;

for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  visit(source);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(source);
      if (name === "Button" || name === "button") {
        const attributes = new Set(node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => attribute.name.getText(source)));
        const actionable = ["onClick", "asChild", "formAction", "disabled"].some((attribute) => attributes.has(attribute)) || insideActionWrapper(node);
        const type = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "type");
        const explicitSubmit = type && type.initializer?.getText(source).includes("submit");
        if (!actionable && !explicitSubmit && !insideForm(node)) report(file, source, node, `${name} has no action`);
      }
      if (name === "a") {
        const href = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "href");
        if (!href || href.initializer?.getText(source).replace(/["']/g, "") === "#") report(file, source, node, "Anchor has no destination");
      }
    }
    ts.forEachChild(node, visit);
  }
}

function insideForm(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.openingElement?.tagName?.getText?.() === "form") return true;
  }
  return false;
}

function insideActionWrapper(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent)) {
      const tag = parent.openingElement.tagName.getText();
      if (["Link", "DropdownMenuTrigger", "DialogTrigger", "SheetTrigger"].includes(tag)) return true;
    }
  }
  return false;
}

function report(file, source, node, message) {
  findings += 1;
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  console.log(`${file}:${location.line + 1}:${location.character + 1} ${message}`);
}

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

if (findings) process.exitCode = 1;
else console.log(`PASS: ${files.length} UI files contain no inert buttons or empty anchors.`);

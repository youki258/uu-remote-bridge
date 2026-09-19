var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/doctor-regress.ts
var import_strict = __toESM(require("node:assert/strict"));

// src/cli.ts
var CLI_FILE_NAME = process.platform === "win32" ? "uuyc-cli.exe" : "uuyc-cli";
function looksLikeError(r) {
  if (r.code !== 0) {
    return true;
  }
  const errRe = /(?:^|\r?\n)\s*Error:/;
  return errRe.test(r.stderr) || errRe.test(r.stdout);
}

// src/doctor.ts
function classifyTermDiagnostic(text) {
  const normalized = text.trim();
  if (/锁屏|账户密码|系统账户验证|screen.*lock|password/i.test(normalized)) {
    return { status: "LOCKED", hint: "\u8BF7\u5148\u5B8C\u6210\u88AB\u63A7\u7AEF\u7CFB\u7EDF\u8D26\u6237\u9A8C\u8BC1" };
  }
  if (/attached from another window|已被其他窗口|会话.*占用|already exists/i.test(normalized)) {
    return { status: "BUSY", hint: "\u5F53\u524D\u7EC8\u7AEF\u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u5360\u7528\uFF0C\u8BF7\u7B49\u5F85\u540E\u91CD\u8BD5" };
  }
  if (/不支持远程终端管道|不支持.*管道|unknown option.*device-id|term.*unsupported/i.test(normalized)) {
    return { status: "UNSUPPORTED_CLI", hint: "\u8BF7\u5347\u7EA7 UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F" };
  }
  if (/设备离线|无法连接.*设备|设备不存在|主程序.*未运行|未登录|device.*offline|not found/i.test(normalized)) {
    return { status: "UNAVAILABLE", hint: "\u8BF7\u786E\u8BA4\u8BBE\u5907\u5728\u7EBF\u4E14 UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F\u5DF2\u767B\u5F55" };
  }
  if (/版本过低|版本不匹配|不再兼容|协议版本|通道.*未激活|terminal.*not.*active|open.*terminal/i.test(normalized)) {
    return {
      status: "NEEDS_ACTIVATION_OR_VERSION_MISMATCH",
      hint: "\u8BF7\u5148\u5728 UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F\u4E2D\u6253\u5F00\u8BE5\u8BBE\u5907\u7684\u7EC8\u7AEF\u7A97\u53E3\uFF1B\u4ECD\u5931\u8D25\u65F6\u68C0\u67E5\u4E3B\u63A7\u7AEF\u4E0E\u88AB\u63A7\u7AEF\u7248\u672C"
    };
  }
  return { status: "UNKNOWN" };
}

// tests/doctor-regress.ts
var cases = [
  {
    name: "suggests GUI activation for compatibility-shaped failures",
    text: "[\u7EC8\u7AEF] \u4E3B\u63A7\u7AEF\u7248\u672C\u8FC7\u4F4E\uFF0C\u88AB\u63A7\u7AEF\u4E0D\u518D\u517C\u5BB9\u6B64\u534F\u8BAE\u7248\u672C",
    status: "NEEDS_ACTIVATION_OR_VERSION_MISMATCH",
    hint: "\u8BF7\u5148\u5728 UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F\u4E2D\u6253\u5F00\u8BE5\u8BBE\u5907\u7684\u7EC8\u7AEF\u7A97\u53E3"
  },
  {
    name: "recognizes locked devices",
    text: "[\u7CFB\u7EDF] \u68C0\u6D4B\u5230\u88AB\u63A7\u7AEF\u5DF2\u9501\u5C4F\uFF0C\u8BF7\u8F93\u5165\u88AB\u63A7\u7AEF\u8D26\u6237\u5BC6\u7801\u9A8C\u8BC1\u8EAB\u4EFD",
    status: "LOCKED",
    hint: "\u8BF7\u5148\u5B8C\u6210\u88AB\u63A7\u7AEF\u7CFB\u7EDF\u8D26\u6237\u9A8C\u8BC1"
  },
  {
    name: "recognizes sessions attached elsewhere",
    text: "attached from another window",
    status: "BUSY",
    hint: "\u5F53\u524D\u7EC8\u7AEF\u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u5360\u7528\uFF0C\u8BF7\u7B49\u5F85\u540E\u91CD\u8BD5"
  },
  {
    name: "recognizes unavailable devices",
    text: "\u8BBE\u5907\u79BB\u7EBF\uFF0C\u65E0\u6CD5\u5EFA\u7ACB\u8FDC\u7A0B\u7EC8\u7AEF",
    status: "UNAVAILABLE",
    hint: "\u8BF7\u786E\u8BA4\u8BBE\u5907\u5728\u7EBF\u4E14 UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F\u5DF2\u767B\u5F55"
  },
  {
    name: "recognizes unsupported old CLIs",
    text: "\u5F53\u524D uuyc-cli \u7248\u672C\u4E0D\u652F\u6301\u8FDC\u7A0B\u7EC8\u7AEF\u7BA1\u9053\u901A\u9053",
    status: "UNSUPPORTED_CLI",
    hint: "\u8BF7\u5347\u7EA7 UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F"
  },
  {
    name: "falls back to unknown diagnostics",
    text: "some unexpected failure",
    status: "UNKNOWN",
    hint: void 0
  }
];
for (const testCase of cases) {
  const result = classifyTermDiagnostic(testCase.text);
  import_strict.default.equal(result.status, testCase.status, testCase.name);
  if (testCase.hint) {
    import_strict.default.match(result.hint ?? "", new RegExp(testCase.hint));
  } else {
    import_strict.default.equal(result.hint, void 0, testCase.name);
  }
}
import_strict.default.equal(classifyTermDiagnostic("").status, "UNKNOWN");
import_strict.default.equal(looksLikeError({ code: 0, stdout: "Error: terminal not active", stderr: "" }), true);
console.log(`doctor diagnostics: ${cases.length + 1} cases passed`);

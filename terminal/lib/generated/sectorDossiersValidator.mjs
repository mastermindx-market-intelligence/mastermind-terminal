/* eslint-disable */
// GENERATED FILE — DO NOT EDIT.
//
// Source:     lib/sectorDossiersSchema.ts
// Generator:  scripts/gen_sector_dossiers_validator.mjs
// Regenerate: npm run gen:sector-dossiers-validator   (from terminal/)
//
// The two Persistent Sector Leadership validators, compiled ahead of time by Ajv's standalone
// code generator. This module imports nothing and generates no code at runtime, so it loads
// under the production Content-Security-Policy, which carries no 'unsafe-eval'.
// lib/__tests__/sectorDossiersValidator.test.ts fails while this file is stale.
// ---- Ajv runtime helpers and ajv-formats' format table, inlined ----
var __sectorDossiersAjvHelpers = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // node_modules/ajv-formats/dist/formats.js
  var require_formats = __commonJS({
    "node_modules/ajv-formats/dist/formats.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.formatNames = exports.fastFormats = exports.fullFormats = void 0;
      function fmtDef(validate, compare) {
        return { validate, compare };
      }
      exports.fullFormats = {
        // date: http://tools.ietf.org/html/rfc3339#section-5.6
        date: fmtDef(date, compareDate),
        // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
        time: fmtDef(getTime(true), compareTime),
        "date-time": fmtDef(getDateTime(true), compareDateTime),
        "iso-time": fmtDef(getTime(), compareIsoTime),
        "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
        // duration: https://tools.ietf.org/html/rfc3339#appendix-A
        duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
        uri,
        "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
        // uri-template: https://tools.ietf.org/html/rfc6570
        "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
        // For the source: https://gist.github.com/dperini/729294
        // For test cases: https://mathiasbynens.be/demo/url-regex
        url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
        email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
        hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
        // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
        ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
        ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
        regex,
        // uuid: http://tools.ietf.org/html/rfc4122
        uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
        // JSON-pointer: https://tools.ietf.org/html/rfc6901
        // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
        "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
        "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
        // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
        "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
        // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
        // byte: https://github.com/miguelmota/is-base64
        byte,
        // signed 32 bit integer
        int32: { type: "number", validate: validateInt32 },
        // signed 64 bit integer
        int64: { type: "number", validate: validateInt64 },
        // C-type float
        float: { type: "number", validate: validateNumber },
        // C-type double
        double: { type: "number", validate: validateNumber },
        // hint to the UI to hide input strings
        password: true,
        // unchecked string payload
        binary: true
      };
      exports.fastFormats = {
        ...exports.fullFormats,
        date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
        time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
        "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
        "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
        "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
        // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
        uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
        "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
        // email (sources from jsen validator):
        // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
        // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
        email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
      };
      exports.formatNames = Object.keys(exports.fullFormats);
      function isLeapYear(year) {
        return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      }
      var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
      var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      function date(str) {
        const matches = DATE.exec(str);
        if (!matches)
          return false;
        const year = +matches[1];
        const month = +matches[2];
        const day = +matches[3];
        return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
      }
      function compareDate(d1, d2) {
        if (!(d1 && d2))
          return void 0;
        if (d1 > d2)
          return 1;
        if (d1 < d2)
          return -1;
        return 0;
      }
      var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
      function getTime(strictTimeZone) {
        return function time(str) {
          const matches = TIME.exec(str);
          if (!matches)
            return false;
          const hr = +matches[1];
          const min = +matches[2];
          const sec = +matches[3];
          const tz = matches[4];
          const tzSign = matches[5] === "-" ? -1 : 1;
          const tzH = +(matches[6] || 0);
          const tzM = +(matches[7] || 0);
          if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
            return false;
          if (hr <= 23 && min <= 59 && sec < 60)
            return true;
          const utcMin = min - tzM * tzSign;
          const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
          return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
        };
      }
      function compareTime(s1, s2) {
        if (!(s1 && s2))
          return void 0;
        const t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf();
        const t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
        if (!(t1 && t2))
          return void 0;
        return t1 - t2;
      }
      function compareIsoTime(t1, t2) {
        if (!(t1 && t2))
          return void 0;
        const a1 = TIME.exec(t1);
        const a2 = TIME.exec(t2);
        if (!(a1 && a2))
          return void 0;
        t1 = a1[1] + a1[2] + a1[3];
        t2 = a2[1] + a2[2] + a2[3];
        if (t1 > t2)
          return 1;
        if (t1 < t2)
          return -1;
        return 0;
      }
      var DATE_TIME_SEPARATOR = /t|\s/i;
      function getDateTime(strictTimeZone) {
        const time = getTime(strictTimeZone);
        return function date_time(str) {
          const dateTime = str.split(DATE_TIME_SEPARATOR);
          return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
        };
      }
      function compareDateTime(dt1, dt2) {
        if (!(dt1 && dt2))
          return void 0;
        const d1 = new Date(dt1).valueOf();
        const d2 = new Date(dt2).valueOf();
        if (!(d1 && d2))
          return void 0;
        return d1 - d2;
      }
      function compareIsoDateTime(dt1, dt2) {
        if (!(dt1 && dt2))
          return void 0;
        const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
        const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
        const res = compareDate(d1, d2);
        if (res === void 0)
          return void 0;
        return res || compareTime(t1, t2);
      }
      var NOT_URI_FRAGMENT = /\/|:/;
      var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
      function uri(str) {
        return NOT_URI_FRAGMENT.test(str) && URI.test(str);
      }
      var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
      function byte(str) {
        BYTE.lastIndex = 0;
        return BYTE.test(str);
      }
      var MIN_INT32 = -(2 ** 31);
      var MAX_INT32 = 2 ** 31 - 1;
      function validateInt32(value) {
        return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
      }
      function validateInt64(value) {
        return Number.isInteger(value);
      }
      function validateNumber() {
        return true;
      }
      var Z_ANCHOR = /[^\\]\\Z/;
      function regex(str) {
        if (Z_ANCHOR.test(str))
          return false;
        try {
          new RegExp(str);
          return true;
        } catch (e) {
          return false;
        }
      }
    }
  });

  // node_modules/fast-deep-equal/index.js
  var require_fast_deep_equal = __commonJS({
    "node_modules/fast-deep-equal/index.js"(exports, module) {
      "use strict";
      module.exports = function equal(a, b) {
        if (a === b) return true;
        if (a && b && typeof a == "object" && typeof b == "object") {
          if (a.constructor !== b.constructor) return false;
          var length, i, keys;
          if (Array.isArray(a)) {
            length = a.length;
            if (length != b.length) return false;
            for (i = length; i-- !== 0; )
              if (!equal(a[i], b[i])) return false;
            return true;
          }
          if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
          if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
          if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
          keys = Object.keys(a);
          length = keys.length;
          if (length !== Object.keys(b).length) return false;
          for (i = length; i-- !== 0; )
            if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
          for (i = length; i-- !== 0; ) {
            var key = keys[i];
            if (!equal(a[key], b[key])) return false;
          }
          return true;
        }
        return a !== a && b !== b;
      };
    }
  });

  // node_modules/ajv/dist/runtime/equal.js
  var require_equal = __commonJS({
    "node_modules/ajv/dist/runtime/equal.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var equal = require_fast_deep_equal();
      equal.code = 'require("ajv/dist/runtime/equal").default';
      exports.default = equal;
    }
  });

  // node_modules/ajv/dist/runtime/ucs2length.js
  var require_ucs2length = __commonJS({
    "node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      function ucs2length(str) {
        const len = str.length;
        let length = 0;
        let pos = 0;
        let value;
        while (pos < len) {
          length++;
          value = str.charCodeAt(pos++);
          if (value >= 55296 && value <= 56319 && pos < len) {
            value = str.charCodeAt(pos);
            if ((value & 64512) === 56320)
              pos++;
          }
        }
        return length;
      }
      exports.default = ucs2length;
      ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
    }
  });

  // sectorDossiersValidator.helpers.js
  var require_sectorDossiersValidator_helpers = __commonJS({
    "sectorDossiersValidator.helpers.js"(exports, module) {
      module.exports = {
        "ajv-formats/dist/formats": require_formats(),
        "ajv/dist/runtime/equal": require_equal(),
        "ajv/dist/runtime/ucs2length": require_ucs2length()
      };
    }
  });
  return require_sectorDossiersValidator_helpers();
})();

// ---- Ajv standalone validators, as generated ----
export const validateSectorDossiers = validate10;
const schema11 = {"type":"object","properties":{"schema":{"const":"leadership_rotation_context.sector_dossiers/v1"},"status":{"enum":["partial","unavailable"]},"measurement_status":{"enum":["available","partial","unavailable"]},"cohort_id":{"const":"us_sectors_11"},"population":{"const":"eleven_sector_etf_proxies"},"as_of":{"anyOf":[{"type":"string","format":"date","pattern":"^\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},{"type":"null"}]},"benchmark":{"anyOf":[{"type":"string","pattern":"^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])","not":{"enum":["UNKNOWN","NONE","NULL"]}},{"type":"null"}]},"price_basis":{"enum":["total_return",null]},"units":{"const":"pct"},"windows_sessions":{"const":[21,63]},"unavailable_windows":{"type":"object","properties":{"sessions":{"const":[5,20]},"reason":{"const":"not_supplied_by_owner"}},"required":["sessions","reason"],"additionalProperties":false},"absolute_returns":{"type":"object","properties":{"status":{"const":"unavailable"},"reason":{"const":"not_supplied_by_owner"}},"required":["status","reason"],"additionalProperties":false},"compatibility_key":{"anyOf":[{"type":"string","minLength":1,"maxLength":160,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"source_generation":{"type":"object","properties":{"status":{"const":"unavailable"},"reason":{"const":"immutable_generation_not_supplied"},"id":{"const":null}},"required":["status","reason","id"],"additionalProperties":false},"availability":{"type":"object","properties":{"mode":{"enum":["dated_snapshot","as_known"]},"decision_cutoff":{"anyOf":[{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])","format":"date-time"},{"type":"null"}]},"original_available_at":{"const":null},"historically_admissible":{"const":false},"reason":{"enum":["original_availability_not_supplied","invalid_decision_cutoff","source_session_after_decision_cutoff","availability_time_missing"]}},"required":["mode","decision_cutoff","original_available_at","historically_admissible","reason"],"additionalProperties":false},"history":{"type":"object","properties":{"mode":{"const":"reconstructed_price_history"},"naturally_observed":{"const":false}},"required":["mode","naturally_observed"],"additionalProperties":false},"freshness":{"type":"object","properties":{"status":{"const":"unverified"},"reason":{"const":"owner_freshness_receipt_not_supplied"}},"required":["status","reason"],"additionalProperties":false},"corrections":{"type":"object","properties":{"status":{"const":"unavailable"},"reason":{"const":"native_revision_selection_not_supplied"}},"required":["status","reason"],"additionalProperties":false},"authority":{"type":"object","properties":{"may_rank":{"const":false},"may_gate":{"const":false},"may_size":{"const":false},"may_trade":{"const":false},"may_escalate":{"const":false}},"required":["may_rank","may_gate","may_size","may_trade","may_escalate"],"additionalProperties":false},"forecasts":{"type":"object","properties":{"status":{"const":"not_qualified"},"expected_return":{"const":null},"persistence_estimate":{"const":null},"allocation_weight":{"const":null}},"required":["status","expected_return","persistence_estimate","allocation_weight"],"additionalProperties":false},"mechanism":{"type":"object","properties":{"status":{"const":"unavailable"},"reason":{"const":"no_qualified_evidence"},"owner":{"const":"engine.theme_graph"}},"required":["status","reason","owner"],"additionalProperties":false},"risk":{"type":"object","properties":{"status":{"const":"unavailable"},"reason":{"const":"no_qualified_risk_context"},"owner":{"const":"engine.risk_envelope"},"scope":{"const":null}},"required":["status","reason","owner","scope"],"additionalProperties":false},"constituent_breadth":{"type":"object","properties":{"status":{"const":"unavailable"},"reason":{"const":"native_membership_not_supplied"}},"required":["status","reason"],"additionalProperties":false},"constituent_concentration":{"type":"object","properties":{"status":{"const":"unavailable"},"reason":{"const":"native_weights_not_supplied"}},"required":["status","reason"],"additionalProperties":false},"cross_sector_breadth_counts":{"type":"object","properties":{"21":{"type":"object","properties":{"expected_n":{"const":11},"measured_n":{"type":"integer","minimum":0,"maximum":11},"positive_n":{"anyOf":[{"type":"integer","minimum":0,"maximum":11},{"type":"null"}]}},"required":["expected_n","measured_n","positive_n"],"additionalProperties":false},"63":{"type":"object","properties":{"expected_n":{"const":11},"measured_n":{"type":"integer","minimum":0,"maximum":11},"positive_n":{"anyOf":[{"type":"integer","minimum":0,"maximum":11},{"type":"null"}]}},"required":["expected_n","measured_n","positive_n"],"additionalProperties":false}},"required":["21","63"],"additionalProperties":false},"dependency_audit":{"type":"object","properties":{"source_roots":{"type":"array","items":{"const":"engine.sector_cycles"},"maxItems":1,"uniqueItems":true},"source_family_count":{"type":"integer","minimum":0,"maximum":1},"independence":{"const":"not_established"},"shared_rolling_windows":{"const":true},"constituent_overlap":{"const":"unknown"}},"required":["source_roots","source_family_count","independence","shared_rolling_windows","constituent_overlap"],"additionalProperties":false},"diagnostics":{"type":"object","properties":{"qualification_reasons":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},"maxItems":32,"uniqueItems":true},"duplicate_groups":{"type":"array","items":{"enum":["XLB","XLC","XLE","XLF","XLI","XLK","XLP","XLRE","XLU","XLV","XLY"]},"maxItems":11,"uniqueItems":true},"outside_cohort":{"type":"array","items":{"type":"string","pattern":"^[A-Z][A-Z0-9]{0,7}(?![\\s\\S])"},"maxItems":11,"uniqueItems":true},"malformed_source_rows":{"type":"integer","minimum":0,"maximum":128},"malformed_measured_rows":{"type":"integer","minimum":0,"maximum":128}},"required":["qualification_reasons","duplicate_groups","outside_cohort","malformed_source_rows","malformed_measured_rows"],"additionalProperties":false},"groups":{"type":"array","minItems":11,"maxItems":11,"items":{"type":"object","properties":{"group_id":{"enum":["XLB","XLC","XLE","XLF","XLI","XLK","XLP","XLRE","XLU","XLV","XLY"]},"name_en":{"anyOf":[{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"name_zh":{"anyOf":[{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"status":{"enum":["available","partial","unavailable"]},"relative_wealth_pct":{"type":"object","properties":{"rs_21d":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"rs_63d":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]}},"required":["rs_21d","rs_63d"],"additionalProperties":false},"null_reasons":{"type":"object","properties":{"rs_21d":{"anyOf":[{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"rs_63d":{"anyOf":[{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]}},"required":["rs_21d","rs_63d"],"additionalProperties":false},"qualification_reasons":{"type":"array","items":{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},"maxItems":32,"uniqueItems":true}},"required":["group_id","name_en","name_zh","status","relative_wealth_pct","null_reasons","qualification_reasons"],"additionalProperties":false}}},"required":["schema","status","measurement_status","cohort_id","population","as_of","benchmark","price_basis","units","windows_sessions","unavailable_windows","absolute_returns","compatibility_key","source_generation","availability","history","freshness","corrections","authority","forecasts","mechanism","risk","constituent_breadth","constituent_concentration","cross_sector_breadth_counts","dependency_audit","diagnostics","groups"],"additionalProperties":false};
const func0 = Object.prototype.hasOwnProperty;
const func32 = __sectorDossiersAjvHelpers["ajv/dist/runtime/equal"].default;
const func97 = __sectorDossiersAjvHelpers["ajv/dist/runtime/ucs2length"].default;
const formats0 = __sectorDossiersAjvHelpers["ajv-formats/dist/formats"].fullFormats.date;
const formats2 = __sectorDossiersAjvHelpers["ajv-formats/dist/formats"].fullFormats["date-time"];
const pattern0 = new RegExp("^\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])", "u");
const pattern1 = new RegExp("^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])", "u");
const pattern2 = new RegExp("^[^\\u0000-\\u001f]+(?![\\s\\S])", "u");
const pattern5 = new RegExp("^[A-Z][A-Z0-9]{0,7}(?![\\s\\S])", "u");

function validate10(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(errors === 0){
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((((((((((((((((((((((((((((((data.schema === undefined) || (!(func0.call(data, "schema")))) && (missing0 = "schema")) || (((data.status === undefined) || (!(func0.call(data, "status")))) && (missing0 = "status"))) || (((data.measurement_status === undefined) || (!(func0.call(data, "measurement_status")))) && (missing0 = "measurement_status"))) || (((data.cohort_id === undefined) || (!(func0.call(data, "cohort_id")))) && (missing0 = "cohort_id"))) || (((data.population === undefined) || (!(func0.call(data, "population")))) && (missing0 = "population"))) || (((data.as_of === undefined) || (!(func0.call(data, "as_of")))) && (missing0 = "as_of"))) || (((data.benchmark === undefined) || (!(func0.call(data, "benchmark")))) && (missing0 = "benchmark"))) || (((data.price_basis === undefined) || (!(func0.call(data, "price_basis")))) && (missing0 = "price_basis"))) || (((data.units === undefined) || (!(func0.call(data, "units")))) && (missing0 = "units"))) || (((data.windows_sessions === undefined) || (!(func0.call(data, "windows_sessions")))) && (missing0 = "windows_sessions"))) || (((data.unavailable_windows === undefined) || (!(func0.call(data, "unavailable_windows")))) && (missing0 = "unavailable_windows"))) || (((data.absolute_returns === undefined) || (!(func0.call(data, "absolute_returns")))) && (missing0 = "absolute_returns"))) || (((data.compatibility_key === undefined) || (!(func0.call(data, "compatibility_key")))) && (missing0 = "compatibility_key"))) || (((data.source_generation === undefined) || (!(func0.call(data, "source_generation")))) && (missing0 = "source_generation"))) || (((data.availability === undefined) || (!(func0.call(data, "availability")))) && (missing0 = "availability"))) || (((data.history === undefined) || (!(func0.call(data, "history")))) && (missing0 = "history"))) || (((data.freshness === undefined) || (!(func0.call(data, "freshness")))) && (missing0 = "freshness"))) || (((data.corrections === undefined) || (!(func0.call(data, "corrections")))) && (missing0 = "corrections"))) || (((data.authority === undefined) || (!(func0.call(data, "authority")))) && (missing0 = "authority"))) || (((data.forecasts === undefined) || (!(func0.call(data, "forecasts")))) && (missing0 = "forecasts"))) || (((data.mechanism === undefined) || (!(func0.call(data, "mechanism")))) && (missing0 = "mechanism"))) || (((data.risk === undefined) || (!(func0.call(data, "risk")))) && (missing0 = "risk"))) || (((data.constituent_breadth === undefined) || (!(func0.call(data, "constituent_breadth")))) && (missing0 = "constituent_breadth"))) || (((data.constituent_concentration === undefined) || (!(func0.call(data, "constituent_concentration")))) && (missing0 = "constituent_concentration"))) || (((data.cross_sector_breadth_counts === undefined) || (!(func0.call(data, "cross_sector_breadth_counts")))) && (missing0 = "cross_sector_breadth_counts"))) || (((data.dependency_audit === undefined) || (!(func0.call(data, "dependency_audit")))) && (missing0 = "dependency_audit"))) || (((data.diagnostics === undefined) || (!(func0.call(data, "diagnostics")))) && (missing0 = "diagnostics"))) || (((data.groups === undefined) || (!(func0.call(data, "groups")))) && (missing0 = "groups"))){
validate10.errors = [{instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: missing0},message:"must have required property '"+missing0+"'"}];
return false;
}
else {
const _errs1 = errors;
for(const key0 of Object.keys(data)){
if(!(func0.call(schema11.properties, key0))){
validate10.errors = [{instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs1 === errors){
if(data.schema !== undefined && func0.call(data, "schema")){
const _errs2 = errors;
if("leadership_rotation_context.sector_dossiers/v1" !== data.schema){
validate10.errors = [{instancePath:instancePath+"/schema",schemaPath:"#/properties/schema/const",keyword:"const",params:{allowedValue: "leadership_rotation_context.sector_dossiers/v1"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs2 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.status !== undefined && func0.call(data, "status")){
let data1 = data.status;
const _errs3 = errors;
if(!((data1 === "partial") || (data1 === "unavailable"))){
validate10.errors = [{instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema11.properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid0 = _errs3 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.measurement_status !== undefined && func0.call(data, "measurement_status")){
let data2 = data.measurement_status;
const _errs4 = errors;
if(!(((data2 === "available") || (data2 === "partial")) || (data2 === "unavailable"))){
validate10.errors = [{instancePath:instancePath+"/measurement_status",schemaPath:"#/properties/measurement_status/enum",keyword:"enum",params:{allowedValues: schema11.properties.measurement_status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid0 = _errs4 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.cohort_id !== undefined && func0.call(data, "cohort_id")){
const _errs5 = errors;
if("us_sectors_11" !== data.cohort_id){
validate10.errors = [{instancePath:instancePath+"/cohort_id",schemaPath:"#/properties/cohort_id/const",keyword:"const",params:{allowedValue: "us_sectors_11"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs5 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.population !== undefined && func0.call(data, "population")){
const _errs6 = errors;
if("eleven_sector_etf_proxies" !== data.population){
validate10.errors = [{instancePath:instancePath+"/population",schemaPath:"#/properties/population/const",keyword:"const",params:{allowedValue: "eleven_sector_etf_proxies"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs6 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.as_of !== undefined && func0.call(data, "as_of")){
let data5 = data.as_of;
const _errs7 = errors;
const _errs8 = errors;
let valid1 = false;
const _errs9 = errors;
if(errors === _errs9){
if(errors === _errs9){
if(typeof data5 === "string"){
if(!pattern0.test(data5)){
const err0 = {instancePath:instancePath+"/as_of",schemaPath:"#/properties/as_of/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
else {
if(!(formats0.validate(data5))){
const err1 = {instancePath:instancePath+"/as_of",schemaPath:"#/properties/as_of/anyOf/0/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
else {
const err2 = {instancePath:instancePath+"/as_of",schemaPath:"#/properties/as_of/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
var _valid0 = _errs9 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs11 = errors;
if(data5 !== null){
const err3 = {instancePath:instancePath+"/as_of",schemaPath:"#/properties/as_of/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
var _valid0 = _errs11 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err4 = {instancePath:instancePath+"/as_of",schemaPath:"#/properties/as_of/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs8;
if(vErrors !== null){
if(_errs8){
vErrors.length = _errs8;
}
else {
vErrors = null;
}
}
}
var valid0 = _errs7 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.benchmark !== undefined && func0.call(data, "benchmark")){
let data6 = data.benchmark;
const _errs13 = errors;
const _errs14 = errors;
let valid2 = false;
const _errs15 = errors;
const _errs17 = errors;
const _errs18 = errors;
if(!(((data6 === "UNKNOWN") || (data6 === "NONE")) || (data6 === "NULL"))){
const err5 = {};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
var valid3 = _errs18 === errors;
if(valid3){
const err6 = {instancePath:instancePath+"/benchmark",schemaPath:"#/properties/benchmark/anyOf/0/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
else {
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
}
if(errors === _errs15){
if(typeof data6 === "string"){
if(!pattern1.test(data6)){
const err7 = {instancePath:instancePath+"/benchmark",schemaPath:"#/properties/benchmark/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])"},message:"must match pattern \""+"^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/benchmark",schemaPath:"#/properties/benchmark/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
var _valid1 = _errs15 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs19 = errors;
if(data6 !== null){
const err9 = {instancePath:instancePath+"/benchmark",schemaPath:"#/properties/benchmark/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
var _valid1 = _errs19 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err10 = {instancePath:instancePath+"/benchmark",schemaPath:"#/properties/benchmark/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs14;
if(vErrors !== null){
if(_errs14){
vErrors.length = _errs14;
}
else {
vErrors = null;
}
}
}
var valid0 = _errs13 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.price_basis !== undefined && func0.call(data, "price_basis")){
let data7 = data.price_basis;
const _errs21 = errors;
if(!((data7 === "total_return") || (data7 === null))){
validate10.errors = [{instancePath:instancePath+"/price_basis",schemaPath:"#/properties/price_basis/enum",keyword:"enum",params:{allowedValues: schema11.properties.price_basis.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid0 = _errs21 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.units !== undefined && func0.call(data, "units")){
const _errs22 = errors;
if("pct" !== data.units){
validate10.errors = [{instancePath:instancePath+"/units",schemaPath:"#/properties/units/const",keyword:"const",params:{allowedValue: "pct"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs22 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.windows_sessions !== undefined && func0.call(data, "windows_sessions")){
const _errs23 = errors;
if(!func32(data.windows_sessions, schema11.properties.windows_sessions.const)){
validate10.errors = [{instancePath:instancePath+"/windows_sessions",schemaPath:"#/properties/windows_sessions/const",keyword:"const",params:{allowedValue: schema11.properties.windows_sessions.const},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs23 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.unavailable_windows !== undefined && func0.call(data, "unavailable_windows")){
let data10 = data.unavailable_windows;
const _errs24 = errors;
if(errors === _errs24){
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
let missing1;
if((((data10.sessions === undefined) || (!(func0.call(data10, "sessions")))) && (missing1 = "sessions")) || (((data10.reason === undefined) || (!(func0.call(data10, "reason")))) && (missing1 = "reason"))){
validate10.errors = [{instancePath:instancePath+"/unavailable_windows",schemaPath:"#/properties/unavailable_windows/required",keyword:"required",params:{missingProperty: missing1},message:"must have required property '"+missing1+"'"}];
return false;
}
else {
const _errs26 = errors;
for(const key1 of Object.keys(data10)){
if(!((key1 === "sessions") || (key1 === "reason"))){
validate10.errors = [{instancePath:instancePath+"/unavailable_windows",schemaPath:"#/properties/unavailable_windows/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs26 === errors){
if(data10.sessions !== undefined && func0.call(data10, "sessions")){
const _errs27 = errors;
if(!func32(data10.sessions, schema11.properties.unavailable_windows.properties.sessions.const)){
validate10.errors = [{instancePath:instancePath+"/unavailable_windows/sessions",schemaPath:"#/properties/unavailable_windows/properties/sessions/const",keyword:"const",params:{allowedValue: schema11.properties.unavailable_windows.properties.sessions.const},message:"must be equal to constant"}];
return false;
}
var valid4 = _errs27 === errors;
}
else {
var valid4 = true;
}
if(valid4){
if(data10.reason !== undefined && func0.call(data10, "reason")){
const _errs28 = errors;
if("not_supplied_by_owner" !== data10.reason){
validate10.errors = [{instancePath:instancePath+"/unavailable_windows/reason",schemaPath:"#/properties/unavailable_windows/properties/reason/const",keyword:"const",params:{allowedValue: "not_supplied_by_owner"},message:"must be equal to constant"}];
return false;
}
var valid4 = _errs28 === errors;
}
else {
var valid4 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/unavailable_windows",schemaPath:"#/properties/unavailable_windows/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs24 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.absolute_returns !== undefined && func0.call(data, "absolute_returns")){
let data13 = data.absolute_returns;
const _errs29 = errors;
if(errors === _errs29){
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
let missing2;
if((((data13.status === undefined) || (!(func0.call(data13, "status")))) && (missing2 = "status")) || (((data13.reason === undefined) || (!(func0.call(data13, "reason")))) && (missing2 = "reason"))){
validate10.errors = [{instancePath:instancePath+"/absolute_returns",schemaPath:"#/properties/absolute_returns/required",keyword:"required",params:{missingProperty: missing2},message:"must have required property '"+missing2+"'"}];
return false;
}
else {
const _errs31 = errors;
for(const key2 of Object.keys(data13)){
if(!((key2 === "status") || (key2 === "reason"))){
validate10.errors = [{instancePath:instancePath+"/absolute_returns",schemaPath:"#/properties/absolute_returns/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs31 === errors){
if(data13.status !== undefined && func0.call(data13, "status")){
const _errs32 = errors;
if("unavailable" !== data13.status){
validate10.errors = [{instancePath:instancePath+"/absolute_returns/status",schemaPath:"#/properties/absolute_returns/properties/status/const",keyword:"const",params:{allowedValue: "unavailable"},message:"must be equal to constant"}];
return false;
}
var valid5 = _errs32 === errors;
}
else {
var valid5 = true;
}
if(valid5){
if(data13.reason !== undefined && func0.call(data13, "reason")){
const _errs33 = errors;
if("not_supplied_by_owner" !== data13.reason){
validate10.errors = [{instancePath:instancePath+"/absolute_returns/reason",schemaPath:"#/properties/absolute_returns/properties/reason/const",keyword:"const",params:{allowedValue: "not_supplied_by_owner"},message:"must be equal to constant"}];
return false;
}
var valid5 = _errs33 === errors;
}
else {
var valid5 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/absolute_returns",schemaPath:"#/properties/absolute_returns/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs29 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.compatibility_key !== undefined && func0.call(data, "compatibility_key")){
let data16 = data.compatibility_key;
const _errs34 = errors;
const _errs35 = errors;
let valid6 = false;
const _errs36 = errors;
if(errors === _errs36){
if(typeof data16 === "string"){
if(func97(data16) > 160){
const err11 = {instancePath:instancePath+"/compatibility_key",schemaPath:"#/properties/compatibility_key/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 160},message:"must NOT have more than 160 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
else {
if(func97(data16) < 1){
const err12 = {instancePath:instancePath+"/compatibility_key",schemaPath:"#/properties/compatibility_key/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
else {
if(!pattern2.test(data16)){
const err13 = {instancePath:instancePath+"/compatibility_key",schemaPath:"#/properties/compatibility_key/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
}
else {
const err14 = {instancePath:instancePath+"/compatibility_key",schemaPath:"#/properties/compatibility_key/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
var _valid2 = _errs36 === errors;
valid6 = valid6 || _valid2;
if(!valid6){
const _errs38 = errors;
if(data16 !== null){
const err15 = {instancePath:instancePath+"/compatibility_key",schemaPath:"#/properties/compatibility_key/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
var _valid2 = _errs38 === errors;
valid6 = valid6 || _valid2;
}
if(!valid6){
const err16 = {instancePath:instancePath+"/compatibility_key",schemaPath:"#/properties/compatibility_key/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs35;
if(vErrors !== null){
if(_errs35){
vErrors.length = _errs35;
}
else {
vErrors = null;
}
}
}
var valid0 = _errs34 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.source_generation !== undefined && func0.call(data, "source_generation")){
let data17 = data.source_generation;
const _errs40 = errors;
if(errors === _errs40){
if(data17 && typeof data17 == "object" && !Array.isArray(data17)){
let missing3;
if(((((data17.status === undefined) || (!(func0.call(data17, "status")))) && (missing3 = "status")) || (((data17.reason === undefined) || (!(func0.call(data17, "reason")))) && (missing3 = "reason"))) || (((data17.id === undefined) || (!(func0.call(data17, "id")))) && (missing3 = "id"))){
validate10.errors = [{instancePath:instancePath+"/source_generation",schemaPath:"#/properties/source_generation/required",keyword:"required",params:{missingProperty: missing3},message:"must have required property '"+missing3+"'"}];
return false;
}
else {
const _errs42 = errors;
for(const key3 of Object.keys(data17)){
if(!(((key3 === "status") || (key3 === "reason")) || (key3 === "id"))){
validate10.errors = [{instancePath:instancePath+"/source_generation",schemaPath:"#/properties/source_generation/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs42 === errors){
if(data17.status !== undefined && func0.call(data17, "status")){
const _errs43 = errors;
if("unavailable" !== data17.status){
validate10.errors = [{instancePath:instancePath+"/source_generation/status",schemaPath:"#/properties/source_generation/properties/status/const",keyword:"const",params:{allowedValue: "unavailable"},message:"must be equal to constant"}];
return false;
}
var valid7 = _errs43 === errors;
}
else {
var valid7 = true;
}
if(valid7){
if(data17.reason !== undefined && func0.call(data17, "reason")){
const _errs44 = errors;
if("immutable_generation_not_supplied" !== data17.reason){
validate10.errors = [{instancePath:instancePath+"/source_generation/reason",schemaPath:"#/properties/source_generation/properties/reason/const",keyword:"const",params:{allowedValue: "immutable_generation_not_supplied"},message:"must be equal to constant"}];
return false;
}
var valid7 = _errs44 === errors;
}
else {
var valid7 = true;
}
if(valid7){
if(data17.id !== undefined && func0.call(data17, "id")){
const _errs45 = errors;
if(null !== data17.id){
validate10.errors = [{instancePath:instancePath+"/source_generation/id",schemaPath:"#/properties/source_generation/properties/id/const",keyword:"const",params:{allowedValue: schema11.properties.source_generation.properties.id.const},message:"must be equal to constant"}];
return false;
}
var valid7 = _errs45 === errors;
}
else {
var valid7 = true;
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/source_generation",schemaPath:"#/properties/source_generation/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs40 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.availability !== undefined && func0.call(data, "availability")){
let data21 = data.availability;
const _errs46 = errors;
if(errors === _errs46){
if(data21 && typeof data21 == "object" && !Array.isArray(data21)){
let missing4;
if(((((((data21.mode === undefined) || (!(func0.call(data21, "mode")))) && (missing4 = "mode")) || (((data21.decision_cutoff === undefined) || (!(func0.call(data21, "decision_cutoff")))) && (missing4 = "decision_cutoff"))) || (((data21.original_available_at === undefined) || (!(func0.call(data21, "original_available_at")))) && (missing4 = "original_available_at"))) || (((data21.historically_admissible === undefined) || (!(func0.call(data21, "historically_admissible")))) && (missing4 = "historically_admissible"))) || (((data21.reason === undefined) || (!(func0.call(data21, "reason")))) && (missing4 = "reason"))){
validate10.errors = [{instancePath:instancePath+"/availability",schemaPath:"#/properties/availability/required",keyword:"required",params:{missingProperty: missing4},message:"must have required property '"+missing4+"'"}];
return false;
}
else {
const _errs48 = errors;
for(const key4 of Object.keys(data21)){
if(!(((((key4 === "mode") || (key4 === "decision_cutoff")) || (key4 === "original_available_at")) || (key4 === "historically_admissible")) || (key4 === "reason"))){
validate10.errors = [{instancePath:instancePath+"/availability",schemaPath:"#/properties/availability/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs48 === errors){
if(data21.mode !== undefined && func0.call(data21, "mode")){
let data22 = data21.mode;
const _errs49 = errors;
if(!((data22 === "dated_snapshot") || (data22 === "as_known"))){
validate10.errors = [{instancePath:instancePath+"/availability/mode",schemaPath:"#/properties/availability/properties/mode/enum",keyword:"enum",params:{allowedValues: schema11.properties.availability.properties.mode.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid8 = _errs49 === errors;
}
else {
var valid8 = true;
}
if(valid8){
if(data21.decision_cutoff !== undefined && func0.call(data21, "decision_cutoff")){
let data23 = data21.decision_cutoff;
const _errs50 = errors;
const _errs51 = errors;
let valid9 = false;
const _errs52 = errors;
if(errors === _errs52){
if(errors === _errs52){
if(typeof data23 === "string"){
if(func97(data23) > 64){
const err17 = {instancePath:instancePath+"/availability/decision_cutoff",schemaPath:"#/properties/availability/properties/decision_cutoff/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
else {
if(func97(data23) < 1){
const err18 = {instancePath:instancePath+"/availability/decision_cutoff",schemaPath:"#/properties/availability/properties/decision_cutoff/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
else {
if(!pattern2.test(data23)){
const err19 = {instancePath:instancePath+"/availability/decision_cutoff",schemaPath:"#/properties/availability/properties/decision_cutoff/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
else {
if(!(formats2.validate(data23))){
const err20 = {instancePath:instancePath+"/availability/decision_cutoff",schemaPath:"#/properties/availability/properties/decision_cutoff/anyOf/0/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
}
}
else {
const err21 = {instancePath:instancePath+"/availability/decision_cutoff",schemaPath:"#/properties/availability/properties/decision_cutoff/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
var _valid3 = _errs52 === errors;
valid9 = valid9 || _valid3;
if(!valid9){
const _errs54 = errors;
if(data23 !== null){
const err22 = {instancePath:instancePath+"/availability/decision_cutoff",schemaPath:"#/properties/availability/properties/decision_cutoff/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
var _valid3 = _errs54 === errors;
valid9 = valid9 || _valid3;
}
if(!valid9){
const err23 = {instancePath:instancePath+"/availability/decision_cutoff",schemaPath:"#/properties/availability/properties/decision_cutoff/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs51;
if(vErrors !== null){
if(_errs51){
vErrors.length = _errs51;
}
else {
vErrors = null;
}
}
}
var valid8 = _errs50 === errors;
}
else {
var valid8 = true;
}
if(valid8){
if(data21.original_available_at !== undefined && func0.call(data21, "original_available_at")){
const _errs56 = errors;
if(null !== data21.original_available_at){
validate10.errors = [{instancePath:instancePath+"/availability/original_available_at",schemaPath:"#/properties/availability/properties/original_available_at/const",keyword:"const",params:{allowedValue: schema11.properties.availability.properties.original_available_at.const},message:"must be equal to constant"}];
return false;
}
var valid8 = _errs56 === errors;
}
else {
var valid8 = true;
}
if(valid8){
if(data21.historically_admissible !== undefined && func0.call(data21, "historically_admissible")){
const _errs57 = errors;
if(false !== data21.historically_admissible){
validate10.errors = [{instancePath:instancePath+"/availability/historically_admissible",schemaPath:"#/properties/availability/properties/historically_admissible/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid8 = _errs57 === errors;
}
else {
var valid8 = true;
}
if(valid8){
if(data21.reason !== undefined && func0.call(data21, "reason")){
let data26 = data21.reason;
const _errs58 = errors;
if(!((((data26 === "original_availability_not_supplied") || (data26 === "invalid_decision_cutoff")) || (data26 === "source_session_after_decision_cutoff")) || (data26 === "availability_time_missing"))){
validate10.errors = [{instancePath:instancePath+"/availability/reason",schemaPath:"#/properties/availability/properties/reason/enum",keyword:"enum",params:{allowedValues: schema11.properties.availability.properties.reason.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid8 = _errs58 === errors;
}
else {
var valid8 = true;
}
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/availability",schemaPath:"#/properties/availability/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs46 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.history !== undefined && func0.call(data, "history")){
let data27 = data.history;
const _errs59 = errors;
if(errors === _errs59){
if(data27 && typeof data27 == "object" && !Array.isArray(data27)){
let missing5;
if((((data27.mode === undefined) || (!(func0.call(data27, "mode")))) && (missing5 = "mode")) || (((data27.naturally_observed === undefined) || (!(func0.call(data27, "naturally_observed")))) && (missing5 = "naturally_observed"))){
validate10.errors = [{instancePath:instancePath+"/history",schemaPath:"#/properties/history/required",keyword:"required",params:{missingProperty: missing5},message:"must have required property '"+missing5+"'"}];
return false;
}
else {
const _errs61 = errors;
for(const key5 of Object.keys(data27)){
if(!((key5 === "mode") || (key5 === "naturally_observed"))){
validate10.errors = [{instancePath:instancePath+"/history",schemaPath:"#/properties/history/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs61 === errors){
if(data27.mode !== undefined && func0.call(data27, "mode")){
const _errs62 = errors;
if("reconstructed_price_history" !== data27.mode){
validate10.errors = [{instancePath:instancePath+"/history/mode",schemaPath:"#/properties/history/properties/mode/const",keyword:"const",params:{allowedValue: "reconstructed_price_history"},message:"must be equal to constant"}];
return false;
}
var valid10 = _errs62 === errors;
}
else {
var valid10 = true;
}
if(valid10){
if(data27.naturally_observed !== undefined && func0.call(data27, "naturally_observed")){
const _errs63 = errors;
if(false !== data27.naturally_observed){
validate10.errors = [{instancePath:instancePath+"/history/naturally_observed",schemaPath:"#/properties/history/properties/naturally_observed/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid10 = _errs63 === errors;
}
else {
var valid10 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/history",schemaPath:"#/properties/history/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs59 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.freshness !== undefined && func0.call(data, "freshness")){
let data30 = data.freshness;
const _errs64 = errors;
if(errors === _errs64){
if(data30 && typeof data30 == "object" && !Array.isArray(data30)){
let missing6;
if((((data30.status === undefined) || (!(func0.call(data30, "status")))) && (missing6 = "status")) || (((data30.reason === undefined) || (!(func0.call(data30, "reason")))) && (missing6 = "reason"))){
validate10.errors = [{instancePath:instancePath+"/freshness",schemaPath:"#/properties/freshness/required",keyword:"required",params:{missingProperty: missing6},message:"must have required property '"+missing6+"'"}];
return false;
}
else {
const _errs66 = errors;
for(const key6 of Object.keys(data30)){
if(!((key6 === "status") || (key6 === "reason"))){
validate10.errors = [{instancePath:instancePath+"/freshness",schemaPath:"#/properties/freshness/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs66 === errors){
if(data30.status !== undefined && func0.call(data30, "status")){
const _errs67 = errors;
if("unverified" !== data30.status){
validate10.errors = [{instancePath:instancePath+"/freshness/status",schemaPath:"#/properties/freshness/properties/status/const",keyword:"const",params:{allowedValue: "unverified"},message:"must be equal to constant"}];
return false;
}
var valid11 = _errs67 === errors;
}
else {
var valid11 = true;
}
if(valid11){
if(data30.reason !== undefined && func0.call(data30, "reason")){
const _errs68 = errors;
if("owner_freshness_receipt_not_supplied" !== data30.reason){
validate10.errors = [{instancePath:instancePath+"/freshness/reason",schemaPath:"#/properties/freshness/properties/reason/const",keyword:"const",params:{allowedValue: "owner_freshness_receipt_not_supplied"},message:"must be equal to constant"}];
return false;
}
var valid11 = _errs68 === errors;
}
else {
var valid11 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/freshness",schemaPath:"#/properties/freshness/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs64 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.corrections !== undefined && func0.call(data, "corrections")){
let data33 = data.corrections;
const _errs69 = errors;
if(errors === _errs69){
if(data33 && typeof data33 == "object" && !Array.isArray(data33)){
let missing7;
if((((data33.status === undefined) || (!(func0.call(data33, "status")))) && (missing7 = "status")) || (((data33.reason === undefined) || (!(func0.call(data33, "reason")))) && (missing7 = "reason"))){
validate10.errors = [{instancePath:instancePath+"/corrections",schemaPath:"#/properties/corrections/required",keyword:"required",params:{missingProperty: missing7},message:"must have required property '"+missing7+"'"}];
return false;
}
else {
const _errs71 = errors;
for(const key7 of Object.keys(data33)){
if(!((key7 === "status") || (key7 === "reason"))){
validate10.errors = [{instancePath:instancePath+"/corrections",schemaPath:"#/properties/corrections/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key7},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs71 === errors){
if(data33.status !== undefined && func0.call(data33, "status")){
const _errs72 = errors;
if("unavailable" !== data33.status){
validate10.errors = [{instancePath:instancePath+"/corrections/status",schemaPath:"#/properties/corrections/properties/status/const",keyword:"const",params:{allowedValue: "unavailable"},message:"must be equal to constant"}];
return false;
}
var valid12 = _errs72 === errors;
}
else {
var valid12 = true;
}
if(valid12){
if(data33.reason !== undefined && func0.call(data33, "reason")){
const _errs73 = errors;
if("native_revision_selection_not_supplied" !== data33.reason){
validate10.errors = [{instancePath:instancePath+"/corrections/reason",schemaPath:"#/properties/corrections/properties/reason/const",keyword:"const",params:{allowedValue: "native_revision_selection_not_supplied"},message:"must be equal to constant"}];
return false;
}
var valid12 = _errs73 === errors;
}
else {
var valid12 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/corrections",schemaPath:"#/properties/corrections/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs69 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.authority !== undefined && func0.call(data, "authority")){
let data36 = data.authority;
const _errs74 = errors;
if(errors === _errs74){
if(data36 && typeof data36 == "object" && !Array.isArray(data36)){
let missing8;
if(((((((data36.may_rank === undefined) || (!(func0.call(data36, "may_rank")))) && (missing8 = "may_rank")) || (((data36.may_gate === undefined) || (!(func0.call(data36, "may_gate")))) && (missing8 = "may_gate"))) || (((data36.may_size === undefined) || (!(func0.call(data36, "may_size")))) && (missing8 = "may_size"))) || (((data36.may_trade === undefined) || (!(func0.call(data36, "may_trade")))) && (missing8 = "may_trade"))) || (((data36.may_escalate === undefined) || (!(func0.call(data36, "may_escalate")))) && (missing8 = "may_escalate"))){
validate10.errors = [{instancePath:instancePath+"/authority",schemaPath:"#/properties/authority/required",keyword:"required",params:{missingProperty: missing8},message:"must have required property '"+missing8+"'"}];
return false;
}
else {
const _errs76 = errors;
for(const key8 of Object.keys(data36)){
if(!(((((key8 === "may_rank") || (key8 === "may_gate")) || (key8 === "may_size")) || (key8 === "may_trade")) || (key8 === "may_escalate"))){
validate10.errors = [{instancePath:instancePath+"/authority",schemaPath:"#/properties/authority/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key8},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs76 === errors){
if(data36.may_rank !== undefined && func0.call(data36, "may_rank")){
const _errs77 = errors;
if(false !== data36.may_rank){
validate10.errors = [{instancePath:instancePath+"/authority/may_rank",schemaPath:"#/properties/authority/properties/may_rank/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid13 = _errs77 === errors;
}
else {
var valid13 = true;
}
if(valid13){
if(data36.may_gate !== undefined && func0.call(data36, "may_gate")){
const _errs78 = errors;
if(false !== data36.may_gate){
validate10.errors = [{instancePath:instancePath+"/authority/may_gate",schemaPath:"#/properties/authority/properties/may_gate/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid13 = _errs78 === errors;
}
else {
var valid13 = true;
}
if(valid13){
if(data36.may_size !== undefined && func0.call(data36, "may_size")){
const _errs79 = errors;
if(false !== data36.may_size){
validate10.errors = [{instancePath:instancePath+"/authority/may_size",schemaPath:"#/properties/authority/properties/may_size/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid13 = _errs79 === errors;
}
else {
var valid13 = true;
}
if(valid13){
if(data36.may_trade !== undefined && func0.call(data36, "may_trade")){
const _errs80 = errors;
if(false !== data36.may_trade){
validate10.errors = [{instancePath:instancePath+"/authority/may_trade",schemaPath:"#/properties/authority/properties/may_trade/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid13 = _errs80 === errors;
}
else {
var valid13 = true;
}
if(valid13){
if(data36.may_escalate !== undefined && func0.call(data36, "may_escalate")){
const _errs81 = errors;
if(false !== data36.may_escalate){
validate10.errors = [{instancePath:instancePath+"/authority/may_escalate",schemaPath:"#/properties/authority/properties/may_escalate/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid13 = _errs81 === errors;
}
else {
var valid13 = true;
}
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/authority",schemaPath:"#/properties/authority/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs74 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.forecasts !== undefined && func0.call(data, "forecasts")){
let data42 = data.forecasts;
const _errs82 = errors;
if(errors === _errs82){
if(data42 && typeof data42 == "object" && !Array.isArray(data42)){
let missing9;
if((((((data42.status === undefined) || (!(func0.call(data42, "status")))) && (missing9 = "status")) || (((data42.expected_return === undefined) || (!(func0.call(data42, "expected_return")))) && (missing9 = "expected_return"))) || (((data42.persistence_estimate === undefined) || (!(func0.call(data42, "persistence_estimate")))) && (missing9 = "persistence_estimate"))) || (((data42.allocation_weight === undefined) || (!(func0.call(data42, "allocation_weight")))) && (missing9 = "allocation_weight"))){
validate10.errors = [{instancePath:instancePath+"/forecasts",schemaPath:"#/properties/forecasts/required",keyword:"required",params:{missingProperty: missing9},message:"must have required property '"+missing9+"'"}];
return false;
}
else {
const _errs84 = errors;
for(const key9 of Object.keys(data42)){
if(!((((key9 === "status") || (key9 === "expected_return")) || (key9 === "persistence_estimate")) || (key9 === "allocation_weight"))){
validate10.errors = [{instancePath:instancePath+"/forecasts",schemaPath:"#/properties/forecasts/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key9},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs84 === errors){
if(data42.status !== undefined && func0.call(data42, "status")){
const _errs85 = errors;
if("not_qualified" !== data42.status){
validate10.errors = [{instancePath:instancePath+"/forecasts/status",schemaPath:"#/properties/forecasts/properties/status/const",keyword:"const",params:{allowedValue: "not_qualified"},message:"must be equal to constant"}];
return false;
}
var valid14 = _errs85 === errors;
}
else {
var valid14 = true;
}
if(valid14){
if(data42.expected_return !== undefined && func0.call(data42, "expected_return")){
const _errs86 = errors;
if(null !== data42.expected_return){
validate10.errors = [{instancePath:instancePath+"/forecasts/expected_return",schemaPath:"#/properties/forecasts/properties/expected_return/const",keyword:"const",params:{allowedValue: schema11.properties.forecasts.properties.expected_return.const},message:"must be equal to constant"}];
return false;
}
var valid14 = _errs86 === errors;
}
else {
var valid14 = true;
}
if(valid14){
if(data42.persistence_estimate !== undefined && func0.call(data42, "persistence_estimate")){
const _errs87 = errors;
if(null !== data42.persistence_estimate){
validate10.errors = [{instancePath:instancePath+"/forecasts/persistence_estimate",schemaPath:"#/properties/forecasts/properties/persistence_estimate/const",keyword:"const",params:{allowedValue: schema11.properties.forecasts.properties.persistence_estimate.const},message:"must be equal to constant"}];
return false;
}
var valid14 = _errs87 === errors;
}
else {
var valid14 = true;
}
if(valid14){
if(data42.allocation_weight !== undefined && func0.call(data42, "allocation_weight")){
const _errs88 = errors;
if(null !== data42.allocation_weight){
validate10.errors = [{instancePath:instancePath+"/forecasts/allocation_weight",schemaPath:"#/properties/forecasts/properties/allocation_weight/const",keyword:"const",params:{allowedValue: schema11.properties.forecasts.properties.allocation_weight.const},message:"must be equal to constant"}];
return false;
}
var valid14 = _errs88 === errors;
}
else {
var valid14 = true;
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/forecasts",schemaPath:"#/properties/forecasts/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs82 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.mechanism !== undefined && func0.call(data, "mechanism")){
let data47 = data.mechanism;
const _errs89 = errors;
if(errors === _errs89){
if(data47 && typeof data47 == "object" && !Array.isArray(data47)){
let missing10;
if(((((data47.status === undefined) || (!(func0.call(data47, "status")))) && (missing10 = "status")) || (((data47.reason === undefined) || (!(func0.call(data47, "reason")))) && (missing10 = "reason"))) || (((data47.owner === undefined) || (!(func0.call(data47, "owner")))) && (missing10 = "owner"))){
validate10.errors = [{instancePath:instancePath+"/mechanism",schemaPath:"#/properties/mechanism/required",keyword:"required",params:{missingProperty: missing10},message:"must have required property '"+missing10+"'"}];
return false;
}
else {
const _errs91 = errors;
for(const key10 of Object.keys(data47)){
if(!(((key10 === "status") || (key10 === "reason")) || (key10 === "owner"))){
validate10.errors = [{instancePath:instancePath+"/mechanism",schemaPath:"#/properties/mechanism/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key10},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs91 === errors){
if(data47.status !== undefined && func0.call(data47, "status")){
const _errs92 = errors;
if("unavailable" !== data47.status){
validate10.errors = [{instancePath:instancePath+"/mechanism/status",schemaPath:"#/properties/mechanism/properties/status/const",keyword:"const",params:{allowedValue: "unavailable"},message:"must be equal to constant"}];
return false;
}
var valid15 = _errs92 === errors;
}
else {
var valid15 = true;
}
if(valid15){
if(data47.reason !== undefined && func0.call(data47, "reason")){
const _errs93 = errors;
if("no_qualified_evidence" !== data47.reason){
validate10.errors = [{instancePath:instancePath+"/mechanism/reason",schemaPath:"#/properties/mechanism/properties/reason/const",keyword:"const",params:{allowedValue: "no_qualified_evidence"},message:"must be equal to constant"}];
return false;
}
var valid15 = _errs93 === errors;
}
else {
var valid15 = true;
}
if(valid15){
if(data47.owner !== undefined && func0.call(data47, "owner")){
const _errs94 = errors;
if("engine.theme_graph" !== data47.owner){
validate10.errors = [{instancePath:instancePath+"/mechanism/owner",schemaPath:"#/properties/mechanism/properties/owner/const",keyword:"const",params:{allowedValue: "engine.theme_graph"},message:"must be equal to constant"}];
return false;
}
var valid15 = _errs94 === errors;
}
else {
var valid15 = true;
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/mechanism",schemaPath:"#/properties/mechanism/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs89 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.risk !== undefined && func0.call(data, "risk")){
let data51 = data.risk;
const _errs95 = errors;
if(errors === _errs95){
if(data51 && typeof data51 == "object" && !Array.isArray(data51)){
let missing11;
if((((((data51.status === undefined) || (!(func0.call(data51, "status")))) && (missing11 = "status")) || (((data51.reason === undefined) || (!(func0.call(data51, "reason")))) && (missing11 = "reason"))) || (((data51.owner === undefined) || (!(func0.call(data51, "owner")))) && (missing11 = "owner"))) || (((data51.scope === undefined) || (!(func0.call(data51, "scope")))) && (missing11 = "scope"))){
validate10.errors = [{instancePath:instancePath+"/risk",schemaPath:"#/properties/risk/required",keyword:"required",params:{missingProperty: missing11},message:"must have required property '"+missing11+"'"}];
return false;
}
else {
const _errs97 = errors;
for(const key11 of Object.keys(data51)){
if(!((((key11 === "status") || (key11 === "reason")) || (key11 === "owner")) || (key11 === "scope"))){
validate10.errors = [{instancePath:instancePath+"/risk",schemaPath:"#/properties/risk/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key11},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs97 === errors){
if(data51.status !== undefined && func0.call(data51, "status")){
const _errs98 = errors;
if("unavailable" !== data51.status){
validate10.errors = [{instancePath:instancePath+"/risk/status",schemaPath:"#/properties/risk/properties/status/const",keyword:"const",params:{allowedValue: "unavailable"},message:"must be equal to constant"}];
return false;
}
var valid16 = _errs98 === errors;
}
else {
var valid16 = true;
}
if(valid16){
if(data51.reason !== undefined && func0.call(data51, "reason")){
const _errs99 = errors;
if("no_qualified_risk_context" !== data51.reason){
validate10.errors = [{instancePath:instancePath+"/risk/reason",schemaPath:"#/properties/risk/properties/reason/const",keyword:"const",params:{allowedValue: "no_qualified_risk_context"},message:"must be equal to constant"}];
return false;
}
var valid16 = _errs99 === errors;
}
else {
var valid16 = true;
}
if(valid16){
if(data51.owner !== undefined && func0.call(data51, "owner")){
const _errs100 = errors;
if("engine.risk_envelope" !== data51.owner){
validate10.errors = [{instancePath:instancePath+"/risk/owner",schemaPath:"#/properties/risk/properties/owner/const",keyword:"const",params:{allowedValue: "engine.risk_envelope"},message:"must be equal to constant"}];
return false;
}
var valid16 = _errs100 === errors;
}
else {
var valid16 = true;
}
if(valid16){
if(data51.scope !== undefined && func0.call(data51, "scope")){
const _errs101 = errors;
if(null !== data51.scope){
validate10.errors = [{instancePath:instancePath+"/risk/scope",schemaPath:"#/properties/risk/properties/scope/const",keyword:"const",params:{allowedValue: schema11.properties.risk.properties.scope.const},message:"must be equal to constant"}];
return false;
}
var valid16 = _errs101 === errors;
}
else {
var valid16 = true;
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/risk",schemaPath:"#/properties/risk/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs95 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.constituent_breadth !== undefined && func0.call(data, "constituent_breadth")){
let data56 = data.constituent_breadth;
const _errs102 = errors;
if(errors === _errs102){
if(data56 && typeof data56 == "object" && !Array.isArray(data56)){
let missing12;
if((((data56.status === undefined) || (!(func0.call(data56, "status")))) && (missing12 = "status")) || (((data56.reason === undefined) || (!(func0.call(data56, "reason")))) && (missing12 = "reason"))){
validate10.errors = [{instancePath:instancePath+"/constituent_breadth",schemaPath:"#/properties/constituent_breadth/required",keyword:"required",params:{missingProperty: missing12},message:"must have required property '"+missing12+"'"}];
return false;
}
else {
const _errs104 = errors;
for(const key12 of Object.keys(data56)){
if(!((key12 === "status") || (key12 === "reason"))){
validate10.errors = [{instancePath:instancePath+"/constituent_breadth",schemaPath:"#/properties/constituent_breadth/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key12},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs104 === errors){
if(data56.status !== undefined && func0.call(data56, "status")){
const _errs105 = errors;
if("unavailable" !== data56.status){
validate10.errors = [{instancePath:instancePath+"/constituent_breadth/status",schemaPath:"#/properties/constituent_breadth/properties/status/const",keyword:"const",params:{allowedValue: "unavailable"},message:"must be equal to constant"}];
return false;
}
var valid17 = _errs105 === errors;
}
else {
var valid17 = true;
}
if(valid17){
if(data56.reason !== undefined && func0.call(data56, "reason")){
const _errs106 = errors;
if("native_membership_not_supplied" !== data56.reason){
validate10.errors = [{instancePath:instancePath+"/constituent_breadth/reason",schemaPath:"#/properties/constituent_breadth/properties/reason/const",keyword:"const",params:{allowedValue: "native_membership_not_supplied"},message:"must be equal to constant"}];
return false;
}
var valid17 = _errs106 === errors;
}
else {
var valid17 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/constituent_breadth",schemaPath:"#/properties/constituent_breadth/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs102 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.constituent_concentration !== undefined && func0.call(data, "constituent_concentration")){
let data59 = data.constituent_concentration;
const _errs107 = errors;
if(errors === _errs107){
if(data59 && typeof data59 == "object" && !Array.isArray(data59)){
let missing13;
if((((data59.status === undefined) || (!(func0.call(data59, "status")))) && (missing13 = "status")) || (((data59.reason === undefined) || (!(func0.call(data59, "reason")))) && (missing13 = "reason"))){
validate10.errors = [{instancePath:instancePath+"/constituent_concentration",schemaPath:"#/properties/constituent_concentration/required",keyword:"required",params:{missingProperty: missing13},message:"must have required property '"+missing13+"'"}];
return false;
}
else {
const _errs109 = errors;
for(const key13 of Object.keys(data59)){
if(!((key13 === "status") || (key13 === "reason"))){
validate10.errors = [{instancePath:instancePath+"/constituent_concentration",schemaPath:"#/properties/constituent_concentration/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key13},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs109 === errors){
if(data59.status !== undefined && func0.call(data59, "status")){
const _errs110 = errors;
if("unavailable" !== data59.status){
validate10.errors = [{instancePath:instancePath+"/constituent_concentration/status",schemaPath:"#/properties/constituent_concentration/properties/status/const",keyword:"const",params:{allowedValue: "unavailable"},message:"must be equal to constant"}];
return false;
}
var valid18 = _errs110 === errors;
}
else {
var valid18 = true;
}
if(valid18){
if(data59.reason !== undefined && func0.call(data59, "reason")){
const _errs111 = errors;
if("native_weights_not_supplied" !== data59.reason){
validate10.errors = [{instancePath:instancePath+"/constituent_concentration/reason",schemaPath:"#/properties/constituent_concentration/properties/reason/const",keyword:"const",params:{allowedValue: "native_weights_not_supplied"},message:"must be equal to constant"}];
return false;
}
var valid18 = _errs111 === errors;
}
else {
var valid18 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/constituent_concentration",schemaPath:"#/properties/constituent_concentration/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs107 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.cross_sector_breadth_counts !== undefined && func0.call(data, "cross_sector_breadth_counts")){
let data62 = data.cross_sector_breadth_counts;
const _errs112 = errors;
if(errors === _errs112){
if(data62 && typeof data62 == "object" && !Array.isArray(data62)){
let missing14;
if((((data62["21"] === undefined) || (!(func0.call(data62, "21")))) && (missing14 = "21")) || (((data62["63"] === undefined) || (!(func0.call(data62, "63")))) && (missing14 = "63"))){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts",schemaPath:"#/properties/cross_sector_breadth_counts/required",keyword:"required",params:{missingProperty: missing14},message:"must have required property '"+missing14+"'"}];
return false;
}
else {
const _errs114 = errors;
for(const key14 of Object.keys(data62)){
if(!((key14 === "21") || (key14 === "63"))){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts",schemaPath:"#/properties/cross_sector_breadth_counts/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key14},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs114 === errors){
if(data62["21"] !== undefined && func0.call(data62, "21")){
let data63 = data62["21"];
const _errs115 = errors;
if(errors === _errs115){
if(data63 && typeof data63 == "object" && !Array.isArray(data63)){
let missing15;
if(((((data63.expected_n === undefined) || (!(func0.call(data63, "expected_n")))) && (missing15 = "expected_n")) || (((data63.measured_n === undefined) || (!(func0.call(data63, "measured_n")))) && (missing15 = "measured_n"))) || (((data63.positive_n === undefined) || (!(func0.call(data63, "positive_n")))) && (missing15 = "positive_n"))){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/21",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/required",keyword:"required",params:{missingProperty: missing15},message:"must have required property '"+missing15+"'"}];
return false;
}
else {
const _errs117 = errors;
for(const key15 of Object.keys(data63)){
if(!(((key15 === "expected_n") || (key15 === "measured_n")) || (key15 === "positive_n"))){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/21",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key15},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs117 === errors){
if(data63.expected_n !== undefined && func0.call(data63, "expected_n")){
const _errs118 = errors;
if(11 !== data63.expected_n){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/21/expected_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/expected_n/const",keyword:"const",params:{allowedValue: 11},message:"must be equal to constant"}];
return false;
}
var valid20 = _errs118 === errors;
}
else {
var valid20 = true;
}
if(valid20){
if(data63.measured_n !== undefined && func0.call(data63, "measured_n")){
let data65 = data63.measured_n;
const _errs119 = errors;
if(!(((typeof data65 == "number") && (!(data65 % 1) && !isNaN(data65))) && (isFinite(data65)))){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/21/measured_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/measured_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs119){
if((typeof data65 == "number") && (isFinite(data65))){
if(data65 > 11 || isNaN(data65)){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/21/measured_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/measured_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 11},message:"must be <= 11"}];
return false;
}
else {
if(data65 < 0 || isNaN(data65)){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/21/measured_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/measured_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid20 = _errs119 === errors;
}
else {
var valid20 = true;
}
if(valid20){
if(data63.positive_n !== undefined && func0.call(data63, "positive_n")){
let data66 = data63.positive_n;
const _errs121 = errors;
const _errs122 = errors;
let valid21 = false;
const _errs123 = errors;
if(!(((typeof data66 == "number") && (!(data66 % 1) && !isNaN(data66))) && (isFinite(data66)))){
const err24 = {instancePath:instancePath+"/cross_sector_breadth_counts/21/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/positive_n/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(errors === _errs123){
if((typeof data66 == "number") && (isFinite(data66))){
if(data66 > 11 || isNaN(data66)){
const err25 = {instancePath:instancePath+"/cross_sector_breadth_counts/21/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/positive_n/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 11},message:"must be <= 11"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
else {
if(data66 < 0 || isNaN(data66)){
const err26 = {instancePath:instancePath+"/cross_sector_breadth_counts/21/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/positive_n/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
}
var _valid4 = _errs123 === errors;
valid21 = valid21 || _valid4;
if(!valid21){
const _errs125 = errors;
if(data66 !== null){
const err27 = {instancePath:instancePath+"/cross_sector_breadth_counts/21/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/positive_n/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
var _valid4 = _errs125 === errors;
valid21 = valid21 || _valid4;
}
if(!valid21){
const err28 = {instancePath:instancePath+"/cross_sector_breadth_counts/21/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/properties/positive_n/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs122;
if(vErrors !== null){
if(_errs122){
vErrors.length = _errs122;
}
else {
vErrors = null;
}
}
}
var valid20 = _errs121 === errors;
}
else {
var valid20 = true;
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/21",schemaPath:"#/properties/cross_sector_breadth_counts/properties/21/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid19 = _errs115 === errors;
}
else {
var valid19 = true;
}
if(valid19){
if(data62["63"] !== undefined && func0.call(data62, "63")){
let data67 = data62["63"];
const _errs127 = errors;
if(errors === _errs127){
if(data67 && typeof data67 == "object" && !Array.isArray(data67)){
let missing16;
if(((((data67.expected_n === undefined) || (!(func0.call(data67, "expected_n")))) && (missing16 = "expected_n")) || (((data67.measured_n === undefined) || (!(func0.call(data67, "measured_n")))) && (missing16 = "measured_n"))) || (((data67.positive_n === undefined) || (!(func0.call(data67, "positive_n")))) && (missing16 = "positive_n"))){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/63",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/required",keyword:"required",params:{missingProperty: missing16},message:"must have required property '"+missing16+"'"}];
return false;
}
else {
const _errs129 = errors;
for(const key16 of Object.keys(data67)){
if(!(((key16 === "expected_n") || (key16 === "measured_n")) || (key16 === "positive_n"))){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/63",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key16},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs129 === errors){
if(data67.expected_n !== undefined && func0.call(data67, "expected_n")){
const _errs130 = errors;
if(11 !== data67.expected_n){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/63/expected_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/expected_n/const",keyword:"const",params:{allowedValue: 11},message:"must be equal to constant"}];
return false;
}
var valid22 = _errs130 === errors;
}
else {
var valid22 = true;
}
if(valid22){
if(data67.measured_n !== undefined && func0.call(data67, "measured_n")){
let data69 = data67.measured_n;
const _errs131 = errors;
if(!(((typeof data69 == "number") && (!(data69 % 1) && !isNaN(data69))) && (isFinite(data69)))){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/63/measured_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/measured_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs131){
if((typeof data69 == "number") && (isFinite(data69))){
if(data69 > 11 || isNaN(data69)){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/63/measured_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/measured_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 11},message:"must be <= 11"}];
return false;
}
else {
if(data69 < 0 || isNaN(data69)){
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/63/measured_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/measured_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid22 = _errs131 === errors;
}
else {
var valid22 = true;
}
if(valid22){
if(data67.positive_n !== undefined && func0.call(data67, "positive_n")){
let data70 = data67.positive_n;
const _errs133 = errors;
const _errs134 = errors;
let valid23 = false;
const _errs135 = errors;
if(!(((typeof data70 == "number") && (!(data70 % 1) && !isNaN(data70))) && (isFinite(data70)))){
const err29 = {instancePath:instancePath+"/cross_sector_breadth_counts/63/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/positive_n/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(errors === _errs135){
if((typeof data70 == "number") && (isFinite(data70))){
if(data70 > 11 || isNaN(data70)){
const err30 = {instancePath:instancePath+"/cross_sector_breadth_counts/63/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/positive_n/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 11},message:"must be <= 11"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
else {
if(data70 < 0 || isNaN(data70)){
const err31 = {instancePath:instancePath+"/cross_sector_breadth_counts/63/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/positive_n/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
}
var _valid5 = _errs135 === errors;
valid23 = valid23 || _valid5;
if(!valid23){
const _errs137 = errors;
if(data70 !== null){
const err32 = {instancePath:instancePath+"/cross_sector_breadth_counts/63/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/positive_n/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
var _valid5 = _errs137 === errors;
valid23 = valid23 || _valid5;
}
if(!valid23){
const err33 = {instancePath:instancePath+"/cross_sector_breadth_counts/63/positive_n",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/properties/positive_n/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs134;
if(vErrors !== null){
if(_errs134){
vErrors.length = _errs134;
}
else {
vErrors = null;
}
}
}
var valid22 = _errs133 === errors;
}
else {
var valid22 = true;
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts/63",schemaPath:"#/properties/cross_sector_breadth_counts/properties/63/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid19 = _errs127 === errors;
}
else {
var valid19 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/cross_sector_breadth_counts",schemaPath:"#/properties/cross_sector_breadth_counts/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs112 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.dependency_audit !== undefined && func0.call(data, "dependency_audit")){
let data71 = data.dependency_audit;
const _errs139 = errors;
if(errors === _errs139){
if(data71 && typeof data71 == "object" && !Array.isArray(data71)){
let missing17;
if(((((((data71.source_roots === undefined) || (!(func0.call(data71, "source_roots")))) && (missing17 = "source_roots")) || (((data71.source_family_count === undefined) || (!(func0.call(data71, "source_family_count")))) && (missing17 = "source_family_count"))) || (((data71.independence === undefined) || (!(func0.call(data71, "independence")))) && (missing17 = "independence"))) || (((data71.shared_rolling_windows === undefined) || (!(func0.call(data71, "shared_rolling_windows")))) && (missing17 = "shared_rolling_windows"))) || (((data71.constituent_overlap === undefined) || (!(func0.call(data71, "constituent_overlap")))) && (missing17 = "constituent_overlap"))){
validate10.errors = [{instancePath:instancePath+"/dependency_audit",schemaPath:"#/properties/dependency_audit/required",keyword:"required",params:{missingProperty: missing17},message:"must have required property '"+missing17+"'"}];
return false;
}
else {
const _errs141 = errors;
for(const key17 of Object.keys(data71)){
if(!(((((key17 === "source_roots") || (key17 === "source_family_count")) || (key17 === "independence")) || (key17 === "shared_rolling_windows")) || (key17 === "constituent_overlap"))){
validate10.errors = [{instancePath:instancePath+"/dependency_audit",schemaPath:"#/properties/dependency_audit/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key17},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs141 === errors){
if(data71.source_roots !== undefined && func0.call(data71, "source_roots")){
let data72 = data71.source_roots;
const _errs142 = errors;
if(errors === _errs142){
if(Array.isArray(data72)){
if(data72.length > 1){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/source_roots",schemaPath:"#/properties/dependency_audit/properties/source_roots/maxItems",keyword:"maxItems",params:{limit: 1},message:"must NOT have more than 1 items"}];
return false;
}
else {
var valid25 = true;
const len0 = data72.length;
for(let i0=0; i0<len0; i0++){
const _errs144 = errors;
if("engine.sector_cycles" !== data72[i0]){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/source_roots/" + i0,schemaPath:"#/properties/dependency_audit/properties/source_roots/items/const",keyword:"const",params:{allowedValue: "engine.sector_cycles"},message:"must be equal to constant"}];
return false;
}
var valid25 = _errs144 === errors;
if(!valid25){
break;
}
}
if(valid25){
let i1 = data72.length;
let j0;
if(i1 > 1){
outer0:
for(;i1--;){
for(j0 = i1; j0--;){
if(func32(data72[i1], data72[j0])){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/source_roots",schemaPath:"#/properties/dependency_audit/properties/source_roots/uniqueItems",keyword:"uniqueItems",params:{i: i1, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i1+" are identical)"}];
return false;
break outer0;
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/dependency_audit/source_roots",schemaPath:"#/properties/dependency_audit/properties/source_roots/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid24 = _errs142 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data71.source_family_count !== undefined && func0.call(data71, "source_family_count")){
let data74 = data71.source_family_count;
const _errs145 = errors;
if(!(((typeof data74 == "number") && (!(data74 % 1) && !isNaN(data74))) && (isFinite(data74)))){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/source_family_count",schemaPath:"#/properties/dependency_audit/properties/source_family_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs145){
if((typeof data74 == "number") && (isFinite(data74))){
if(data74 > 1 || isNaN(data74)){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/source_family_count",schemaPath:"#/properties/dependency_audit/properties/source_family_count/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"}];
return false;
}
else {
if(data74 < 0 || isNaN(data74)){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/source_family_count",schemaPath:"#/properties/dependency_audit/properties/source_family_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid24 = _errs145 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data71.independence !== undefined && func0.call(data71, "independence")){
const _errs147 = errors;
if("not_established" !== data71.independence){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/independence",schemaPath:"#/properties/dependency_audit/properties/independence/const",keyword:"const",params:{allowedValue: "not_established"},message:"must be equal to constant"}];
return false;
}
var valid24 = _errs147 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data71.shared_rolling_windows !== undefined && func0.call(data71, "shared_rolling_windows")){
const _errs148 = errors;
if(true !== data71.shared_rolling_windows){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/shared_rolling_windows",schemaPath:"#/properties/dependency_audit/properties/shared_rolling_windows/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"}];
return false;
}
var valid24 = _errs148 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data71.constituent_overlap !== undefined && func0.call(data71, "constituent_overlap")){
const _errs149 = errors;
if("unknown" !== data71.constituent_overlap){
validate10.errors = [{instancePath:instancePath+"/dependency_audit/constituent_overlap",schemaPath:"#/properties/dependency_audit/properties/constituent_overlap/const",keyword:"const",params:{allowedValue: "unknown"},message:"must be equal to constant"}];
return false;
}
var valid24 = _errs149 === errors;
}
else {
var valid24 = true;
}
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/dependency_audit",schemaPath:"#/properties/dependency_audit/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs139 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.diagnostics !== undefined && func0.call(data, "diagnostics")){
let data78 = data.diagnostics;
const _errs150 = errors;
if(errors === _errs150){
if(data78 && typeof data78 == "object" && !Array.isArray(data78)){
let missing18;
if(((((((data78.qualification_reasons === undefined) || (!(func0.call(data78, "qualification_reasons")))) && (missing18 = "qualification_reasons")) || (((data78.duplicate_groups === undefined) || (!(func0.call(data78, "duplicate_groups")))) && (missing18 = "duplicate_groups"))) || (((data78.outside_cohort === undefined) || (!(func0.call(data78, "outside_cohort")))) && (missing18 = "outside_cohort"))) || (((data78.malformed_source_rows === undefined) || (!(func0.call(data78, "malformed_source_rows")))) && (missing18 = "malformed_source_rows"))) || (((data78.malformed_measured_rows === undefined) || (!(func0.call(data78, "malformed_measured_rows")))) && (missing18 = "malformed_measured_rows"))){
validate10.errors = [{instancePath:instancePath+"/diagnostics",schemaPath:"#/properties/diagnostics/required",keyword:"required",params:{missingProperty: missing18},message:"must have required property '"+missing18+"'"}];
return false;
}
else {
const _errs152 = errors;
for(const key18 of Object.keys(data78)){
if(!(((((key18 === "qualification_reasons") || (key18 === "duplicate_groups")) || (key18 === "outside_cohort")) || (key18 === "malformed_source_rows")) || (key18 === "malformed_measured_rows"))){
validate10.errors = [{instancePath:instancePath+"/diagnostics",schemaPath:"#/properties/diagnostics/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key18},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs152 === errors){
if(data78.qualification_reasons !== undefined && func0.call(data78, "qualification_reasons")){
let data79 = data78.qualification_reasons;
const _errs153 = errors;
if(errors === _errs153){
if(Array.isArray(data79)){
if(data79.length > 32){
validate10.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons",schemaPath:"#/properties/diagnostics/properties/qualification_reasons/maxItems",keyword:"maxItems",params:{limit: 32},message:"must NOT have more than 32 items"}];
return false;
}
else {
var valid28 = true;
const len1 = data79.length;
for(let i2=0; i2<len1; i2++){
let data80 = data79[i2];
const _errs155 = errors;
if(errors === _errs155){
if(typeof data80 === "string"){
if(func97(data80) > 120){
validate10.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons/" + i2,schemaPath:"#/properties/diagnostics/properties/qualification_reasons/items/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"}];
return false;
}
else {
if(func97(data80) < 1){
validate10.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons/" + i2,schemaPath:"#/properties/diagnostics/properties/qualification_reasons/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"}];
return false;
}
else {
if(!pattern2.test(data80)){
validate10.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons/" + i2,schemaPath:"#/properties/diagnostics/properties/qualification_reasons/items/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""}];
return false;
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons/" + i2,schemaPath:"#/properties/diagnostics/properties/qualification_reasons/items/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
var valid28 = _errs155 === errors;
if(!valid28){
break;
}
}
if(valid28){
let i3 = data79.length;
let j1;
if(i3 > 1){
const indices0 = {};
for(;i3--;){
let item0 = data79[i3];
if(typeof item0 !== "string"){
continue;
}
if(typeof indices0[item0] == "number"){
j1 = indices0[item0];
validate10.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons",schemaPath:"#/properties/diagnostics/properties/qualification_reasons/uniqueItems",keyword:"uniqueItems",params:{i: i3, j: j1},message:"must NOT have duplicate items (items ## "+j1+" and "+i3+" are identical)"}];
return false;
break;
}
indices0[item0] = i3;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons",schemaPath:"#/properties/diagnostics/properties/qualification_reasons/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid27 = _errs153 === errors;
}
else {
var valid27 = true;
}
if(valid27){
if(data78.duplicate_groups !== undefined && func0.call(data78, "duplicate_groups")){
let data81 = data78.duplicate_groups;
const _errs157 = errors;
if(errors === _errs157){
if(Array.isArray(data81)){
if(data81.length > 11){
validate10.errors = [{instancePath:instancePath+"/diagnostics/duplicate_groups",schemaPath:"#/properties/diagnostics/properties/duplicate_groups/maxItems",keyword:"maxItems",params:{limit: 11},message:"must NOT have more than 11 items"}];
return false;
}
else {
var valid30 = true;
const len2 = data81.length;
for(let i4=0; i4<len2; i4++){
let data82 = data81[i4];
const _errs159 = errors;
if(!(((((((((((data82 === "XLB") || (data82 === "XLC")) || (data82 === "XLE")) || (data82 === "XLF")) || (data82 === "XLI")) || (data82 === "XLK")) || (data82 === "XLP")) || (data82 === "XLRE")) || (data82 === "XLU")) || (data82 === "XLV")) || (data82 === "XLY"))){
validate10.errors = [{instancePath:instancePath+"/diagnostics/duplicate_groups/" + i4,schemaPath:"#/properties/diagnostics/properties/duplicate_groups/items/enum",keyword:"enum",params:{allowedValues: schema11.properties.diagnostics.properties.duplicate_groups.items.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid30 = _errs159 === errors;
if(!valid30){
break;
}
}
if(valid30){
let i5 = data81.length;
let j2;
if(i5 > 1){
outer1:
for(;i5--;){
for(j2 = i5; j2--;){
if(func32(data81[i5], data81[j2])){
validate10.errors = [{instancePath:instancePath+"/diagnostics/duplicate_groups",schemaPath:"#/properties/diagnostics/properties/duplicate_groups/uniqueItems",keyword:"uniqueItems",params:{i: i5, j: j2},message:"must NOT have duplicate items (items ## "+j2+" and "+i5+" are identical)"}];
return false;
break outer1;
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/diagnostics/duplicate_groups",schemaPath:"#/properties/diagnostics/properties/duplicate_groups/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid27 = _errs157 === errors;
}
else {
var valid27 = true;
}
if(valid27){
if(data78.outside_cohort !== undefined && func0.call(data78, "outside_cohort")){
let data83 = data78.outside_cohort;
const _errs160 = errors;
if(errors === _errs160){
if(Array.isArray(data83)){
if(data83.length > 11){
validate10.errors = [{instancePath:instancePath+"/diagnostics/outside_cohort",schemaPath:"#/properties/diagnostics/properties/outside_cohort/maxItems",keyword:"maxItems",params:{limit: 11},message:"must NOT have more than 11 items"}];
return false;
}
else {
var valid32 = true;
const len3 = data83.length;
for(let i6=0; i6<len3; i6++){
let data84 = data83[i6];
const _errs162 = errors;
if(errors === _errs162){
if(typeof data84 === "string"){
if(!pattern5.test(data84)){
validate10.errors = [{instancePath:instancePath+"/diagnostics/outside_cohort/" + i6,schemaPath:"#/properties/diagnostics/properties/outside_cohort/items/pattern",keyword:"pattern",params:{pattern: "^[A-Z][A-Z0-9]{0,7}(?![\\s\\S])"},message:"must match pattern \""+"^[A-Z][A-Z0-9]{0,7}(?![\\s\\S])"+"\""}];
return false;
}
}
else {
validate10.errors = [{instancePath:instancePath+"/diagnostics/outside_cohort/" + i6,schemaPath:"#/properties/diagnostics/properties/outside_cohort/items/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
var valid32 = _errs162 === errors;
if(!valid32){
break;
}
}
if(valid32){
let i7 = data83.length;
let j3;
if(i7 > 1){
const indices1 = {};
for(;i7--;){
let item1 = data83[i7];
if(typeof item1 !== "string"){
continue;
}
if(typeof indices1[item1] == "number"){
j3 = indices1[item1];
validate10.errors = [{instancePath:instancePath+"/diagnostics/outside_cohort",schemaPath:"#/properties/diagnostics/properties/outside_cohort/uniqueItems",keyword:"uniqueItems",params:{i: i7, j: j3},message:"must NOT have duplicate items (items ## "+j3+" and "+i7+" are identical)"}];
return false;
break;
}
indices1[item1] = i7;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/diagnostics/outside_cohort",schemaPath:"#/properties/diagnostics/properties/outside_cohort/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid27 = _errs160 === errors;
}
else {
var valid27 = true;
}
if(valid27){
if(data78.malformed_source_rows !== undefined && func0.call(data78, "malformed_source_rows")){
let data85 = data78.malformed_source_rows;
const _errs164 = errors;
if(!(((typeof data85 == "number") && (!(data85 % 1) && !isNaN(data85))) && (isFinite(data85)))){
validate10.errors = [{instancePath:instancePath+"/diagnostics/malformed_source_rows",schemaPath:"#/properties/diagnostics/properties/malformed_source_rows/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs164){
if((typeof data85 == "number") && (isFinite(data85))){
if(data85 > 128 || isNaN(data85)){
validate10.errors = [{instancePath:instancePath+"/diagnostics/malformed_source_rows",schemaPath:"#/properties/diagnostics/properties/malformed_source_rows/maximum",keyword:"maximum",params:{comparison: "<=", limit: 128},message:"must be <= 128"}];
return false;
}
else {
if(data85 < 0 || isNaN(data85)){
validate10.errors = [{instancePath:instancePath+"/diagnostics/malformed_source_rows",schemaPath:"#/properties/diagnostics/properties/malformed_source_rows/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid27 = _errs164 === errors;
}
else {
var valid27 = true;
}
if(valid27){
if(data78.malformed_measured_rows !== undefined && func0.call(data78, "malformed_measured_rows")){
let data86 = data78.malformed_measured_rows;
const _errs166 = errors;
if(!(((typeof data86 == "number") && (!(data86 % 1) && !isNaN(data86))) && (isFinite(data86)))){
validate10.errors = [{instancePath:instancePath+"/diagnostics/malformed_measured_rows",schemaPath:"#/properties/diagnostics/properties/malformed_measured_rows/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs166){
if((typeof data86 == "number") && (isFinite(data86))){
if(data86 > 128 || isNaN(data86)){
validate10.errors = [{instancePath:instancePath+"/diagnostics/malformed_measured_rows",schemaPath:"#/properties/diagnostics/properties/malformed_measured_rows/maximum",keyword:"maximum",params:{comparison: "<=", limit: 128},message:"must be <= 128"}];
return false;
}
else {
if(data86 < 0 || isNaN(data86)){
validate10.errors = [{instancePath:instancePath+"/diagnostics/malformed_measured_rows",schemaPath:"#/properties/diagnostics/properties/malformed_measured_rows/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid27 = _errs166 === errors;
}
else {
var valid27 = true;
}
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/diagnostics",schemaPath:"#/properties/diagnostics/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs150 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.groups !== undefined && func0.call(data, "groups")){
let data87 = data.groups;
const _errs168 = errors;
if(errors === _errs168){
if(Array.isArray(data87)){
if(data87.length > 11){
validate10.errors = [{instancePath:instancePath+"/groups",schemaPath:"#/properties/groups/maxItems",keyword:"maxItems",params:{limit: 11},message:"must NOT have more than 11 items"}];
return false;
}
else {
if(data87.length < 11){
validate10.errors = [{instancePath:instancePath+"/groups",schemaPath:"#/properties/groups/minItems",keyword:"minItems",params:{limit: 11},message:"must NOT have fewer than 11 items"}];
return false;
}
else {
var valid34 = true;
const len4 = data87.length;
for(let i8=0; i8<len4; i8++){
let data88 = data87[i8];
const _errs170 = errors;
if(errors === _errs170){
if(data88 && typeof data88 == "object" && !Array.isArray(data88)){
let missing19;
if(((((((((data88.group_id === undefined) || (!(func0.call(data88, "group_id")))) && (missing19 = "group_id")) || (((data88.name_en === undefined) || (!(func0.call(data88, "name_en")))) && (missing19 = "name_en"))) || (((data88.name_zh === undefined) || (!(func0.call(data88, "name_zh")))) && (missing19 = "name_zh"))) || (((data88.status === undefined) || (!(func0.call(data88, "status")))) && (missing19 = "status"))) || (((data88.relative_wealth_pct === undefined) || (!(func0.call(data88, "relative_wealth_pct")))) && (missing19 = "relative_wealth_pct"))) || (((data88.null_reasons === undefined) || (!(func0.call(data88, "null_reasons")))) && (missing19 = "null_reasons"))) || (((data88.qualification_reasons === undefined) || (!(func0.call(data88, "qualification_reasons")))) && (missing19 = "qualification_reasons"))){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8,schemaPath:"#/properties/groups/items/required",keyword:"required",params:{missingProperty: missing19},message:"must have required property '"+missing19+"'"}];
return false;
}
else {
const _errs172 = errors;
for(const key19 of Object.keys(data88)){
if(!(((((((key19 === "group_id") || (key19 === "name_en")) || (key19 === "name_zh")) || (key19 === "status")) || (key19 === "relative_wealth_pct")) || (key19 === "null_reasons")) || (key19 === "qualification_reasons"))){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8,schemaPath:"#/properties/groups/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key19},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs172 === errors){
if(data88.group_id !== undefined && func0.call(data88, "group_id")){
let data89 = data88.group_id;
const _errs173 = errors;
if(!(((((((((((data89 === "XLB") || (data89 === "XLC")) || (data89 === "XLE")) || (data89 === "XLF")) || (data89 === "XLI")) || (data89 === "XLK")) || (data89 === "XLP")) || (data89 === "XLRE")) || (data89 === "XLU")) || (data89 === "XLV")) || (data89 === "XLY"))){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/group_id",schemaPath:"#/properties/groups/items/properties/group_id/enum",keyword:"enum",params:{allowedValues: schema11.properties.groups.items.properties.group_id.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid35 = _errs173 === errors;
}
else {
var valid35 = true;
}
if(valid35){
if(data88.name_en !== undefined && func0.call(data88, "name_en")){
let data90 = data88.name_en;
const _errs174 = errors;
const _errs175 = errors;
let valid36 = false;
const _errs176 = errors;
if(errors === _errs176){
if(typeof data90 === "string"){
if(func97(data90) > 120){
const err34 = {instancePath:instancePath+"/groups/" + i8+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
else {
if(func97(data90) < 1){
const err35 = {instancePath:instancePath+"/groups/" + i8+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
else {
if(!pattern2.test(data90)){
const err36 = {instancePath:instancePath+"/groups/" + i8+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
}
else {
const err37 = {instancePath:instancePath+"/groups/" + i8+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
var _valid6 = _errs176 === errors;
valid36 = valid36 || _valid6;
if(!valid36){
const _errs178 = errors;
if(data90 !== null){
const err38 = {instancePath:instancePath+"/groups/" + i8+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
var _valid6 = _errs178 === errors;
valid36 = valid36 || _valid6;
}
if(!valid36){
const err39 = {instancePath:instancePath+"/groups/" + i8+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs175;
if(vErrors !== null){
if(_errs175){
vErrors.length = _errs175;
}
else {
vErrors = null;
}
}
}
var valid35 = _errs174 === errors;
}
else {
var valid35 = true;
}
if(valid35){
if(data88.name_zh !== undefined && func0.call(data88, "name_zh")){
let data91 = data88.name_zh;
const _errs180 = errors;
const _errs181 = errors;
let valid37 = false;
const _errs182 = errors;
if(errors === _errs182){
if(typeof data91 === "string"){
if(func97(data91) > 120){
const err40 = {instancePath:instancePath+"/groups/" + i8+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
else {
if(func97(data91) < 1){
const err41 = {instancePath:instancePath+"/groups/" + i8+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
else {
if(!pattern2.test(data91)){
const err42 = {instancePath:instancePath+"/groups/" + i8+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
}
}
else {
const err43 = {instancePath:instancePath+"/groups/" + i8+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
var _valid7 = _errs182 === errors;
valid37 = valid37 || _valid7;
if(!valid37){
const _errs184 = errors;
if(data91 !== null){
const err44 = {instancePath:instancePath+"/groups/" + i8+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
var _valid7 = _errs184 === errors;
valid37 = valid37 || _valid7;
}
if(!valid37){
const err45 = {instancePath:instancePath+"/groups/" + i8+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs181;
if(vErrors !== null){
if(_errs181){
vErrors.length = _errs181;
}
else {
vErrors = null;
}
}
}
var valid35 = _errs180 === errors;
}
else {
var valid35 = true;
}
if(valid35){
if(data88.status !== undefined && func0.call(data88, "status")){
let data92 = data88.status;
const _errs186 = errors;
if(!(((data92 === "available") || (data92 === "partial")) || (data92 === "unavailable"))){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/status",schemaPath:"#/properties/groups/items/properties/status/enum",keyword:"enum",params:{allowedValues: schema11.properties.groups.items.properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid35 = _errs186 === errors;
}
else {
var valid35 = true;
}
if(valid35){
if(data88.relative_wealth_pct !== undefined && func0.call(data88, "relative_wealth_pct")){
let data93 = data88.relative_wealth_pct;
const _errs187 = errors;
if(errors === _errs187){
if(data93 && typeof data93 == "object" && !Array.isArray(data93)){
let missing20;
if((((data93.rs_21d === undefined) || (!(func0.call(data93, "rs_21d")))) && (missing20 = "rs_21d")) || (((data93.rs_63d === undefined) || (!(func0.call(data93, "rs_63d")))) && (missing20 = "rs_63d"))){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/required",keyword:"required",params:{missingProperty: missing20},message:"must have required property '"+missing20+"'"}];
return false;
}
else {
const _errs189 = errors;
for(const key20 of Object.keys(data93)){
if(!((key20 === "rs_21d") || (key20 === "rs_63d"))){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key20},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs189 === errors){
if(data93.rs_21d !== undefined && func0.call(data93, "rs_21d")){
let data94 = data93.rs_21d;
const _errs190 = errors;
const _errs191 = errors;
let valid39 = false;
const _errs192 = errors;
if(errors === _errs192){
if((typeof data94 == "number") && (isFinite(data94))){
if(data94 < -100 || isNaN(data94)){
const err46 = {instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct/rs_21d",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/properties/rs_21d/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
else {
const err47 = {instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct/rs_21d",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/properties/rs_21d/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
var _valid8 = _errs192 === errors;
valid39 = valid39 || _valid8;
if(!valid39){
const _errs194 = errors;
if(data94 !== null){
const err48 = {instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct/rs_21d",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/properties/rs_21d/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
var _valid8 = _errs194 === errors;
valid39 = valid39 || _valid8;
}
if(!valid39){
const err49 = {instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct/rs_21d",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/properties/rs_21d/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs191;
if(vErrors !== null){
if(_errs191){
vErrors.length = _errs191;
}
else {
vErrors = null;
}
}
}
var valid38 = _errs190 === errors;
}
else {
var valid38 = true;
}
if(valid38){
if(data93.rs_63d !== undefined && func0.call(data93, "rs_63d")){
let data95 = data93.rs_63d;
const _errs196 = errors;
const _errs197 = errors;
let valid40 = false;
const _errs198 = errors;
if(errors === _errs198){
if((typeof data95 == "number") && (isFinite(data95))){
if(data95 < -100 || isNaN(data95)){
const err50 = {instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct/rs_63d",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/properties/rs_63d/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
else {
const err51 = {instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct/rs_63d",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/properties/rs_63d/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
var _valid9 = _errs198 === errors;
valid40 = valid40 || _valid9;
if(!valid40){
const _errs200 = errors;
if(data95 !== null){
const err52 = {instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct/rs_63d",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/properties/rs_63d/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
var _valid9 = _errs200 === errors;
valid40 = valid40 || _valid9;
}
if(!valid40){
const err53 = {instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct/rs_63d",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/properties/rs_63d/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs197;
if(vErrors !== null){
if(_errs197){
vErrors.length = _errs197;
}
else {
vErrors = null;
}
}
}
var valid38 = _errs196 === errors;
}
else {
var valid38 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/relative_wealth_pct/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid35 = _errs187 === errors;
}
else {
var valid35 = true;
}
if(valid35){
if(data88.null_reasons !== undefined && func0.call(data88, "null_reasons")){
let data96 = data88.null_reasons;
const _errs202 = errors;
if(errors === _errs202){
if(data96 && typeof data96 == "object" && !Array.isArray(data96)){
let missing21;
if((((data96.rs_21d === undefined) || (!(func0.call(data96, "rs_21d")))) && (missing21 = "rs_21d")) || (((data96.rs_63d === undefined) || (!(func0.call(data96, "rs_63d")))) && (missing21 = "rs_63d"))){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/null_reasons",schemaPath:"#/properties/groups/items/properties/null_reasons/required",keyword:"required",params:{missingProperty: missing21},message:"must have required property '"+missing21+"'"}];
return false;
}
else {
const _errs204 = errors;
for(const key21 of Object.keys(data96)){
if(!((key21 === "rs_21d") || (key21 === "rs_63d"))){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/null_reasons",schemaPath:"#/properties/groups/items/properties/null_reasons/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key21},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs204 === errors){
if(data96.rs_21d !== undefined && func0.call(data96, "rs_21d")){
let data97 = data96.rs_21d;
const _errs205 = errors;
const _errs206 = errors;
let valid42 = false;
const _errs207 = errors;
if(errors === _errs207){
if(typeof data97 === "string"){
if(func97(data97) > 120){
const err54 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_21d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_21d/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
else {
if(func97(data97) < 1){
const err55 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_21d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_21d/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
else {
if(!pattern2.test(data97)){
const err56 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_21d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_21d/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
}
}
else {
const err57 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_21d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_21d/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
var _valid10 = _errs207 === errors;
valid42 = valid42 || _valid10;
if(!valid42){
const _errs209 = errors;
if(data97 !== null){
const err58 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_21d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_21d/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
var _valid10 = _errs209 === errors;
valid42 = valid42 || _valid10;
}
if(!valid42){
const err59 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_21d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_21d/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs206;
if(vErrors !== null){
if(_errs206){
vErrors.length = _errs206;
}
else {
vErrors = null;
}
}
}
var valid41 = _errs205 === errors;
}
else {
var valid41 = true;
}
if(valid41){
if(data96.rs_63d !== undefined && func0.call(data96, "rs_63d")){
let data98 = data96.rs_63d;
const _errs211 = errors;
const _errs212 = errors;
let valid43 = false;
const _errs213 = errors;
if(errors === _errs213){
if(typeof data98 === "string"){
if(func97(data98) > 120){
const err60 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_63d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_63d/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
else {
if(func97(data98) < 1){
const err61 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_63d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_63d/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
else {
if(!pattern2.test(data98)){
const err62 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_63d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_63d/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
}
}
}
else {
const err63 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_63d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_63d/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
var _valid11 = _errs213 === errors;
valid43 = valid43 || _valid11;
if(!valid43){
const _errs215 = errors;
if(data98 !== null){
const err64 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_63d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_63d/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
var _valid11 = _errs215 === errors;
valid43 = valid43 || _valid11;
}
if(!valid43){
const err65 = {instancePath:instancePath+"/groups/" + i8+"/null_reasons/rs_63d",schemaPath:"#/properties/groups/items/properties/null_reasons/properties/rs_63d/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
validate10.errors = vErrors;
return false;
}
else {
errors = _errs212;
if(vErrors !== null){
if(_errs212){
vErrors.length = _errs212;
}
else {
vErrors = null;
}
}
}
var valid41 = _errs211 === errors;
}
else {
var valid41 = true;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/null_reasons",schemaPath:"#/properties/groups/items/properties/null_reasons/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid35 = _errs202 === errors;
}
else {
var valid35 = true;
}
if(valid35){
if(data88.qualification_reasons !== undefined && func0.call(data88, "qualification_reasons")){
let data99 = data88.qualification_reasons;
const _errs217 = errors;
if(errors === _errs217){
if(Array.isArray(data99)){
if(data99.length > 32){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/qualification_reasons",schemaPath:"#/properties/groups/items/properties/qualification_reasons/maxItems",keyword:"maxItems",params:{limit: 32},message:"must NOT have more than 32 items"}];
return false;
}
else {
var valid44 = true;
const len5 = data99.length;
for(let i9=0; i9<len5; i9++){
let data100 = data99[i9];
const _errs219 = errors;
if(errors === _errs219){
if(typeof data100 === "string"){
if(func97(data100) > 120){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/qualification_reasons/" + i9,schemaPath:"#/properties/groups/items/properties/qualification_reasons/items/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"}];
return false;
}
else {
if(func97(data100) < 1){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/qualification_reasons/" + i9,schemaPath:"#/properties/groups/items/properties/qualification_reasons/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"}];
return false;
}
else {
if(!pattern2.test(data100)){
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/qualification_reasons/" + i9,schemaPath:"#/properties/groups/items/properties/qualification_reasons/items/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""}];
return false;
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/qualification_reasons/" + i9,schemaPath:"#/properties/groups/items/properties/qualification_reasons/items/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
var valid44 = _errs219 === errors;
if(!valid44){
break;
}
}
if(valid44){
let i10 = data99.length;
let j4;
if(i10 > 1){
const indices2 = {};
for(;i10--;){
let item2 = data99[i10];
if(typeof item2 !== "string"){
continue;
}
if(typeof indices2[item2] == "number"){
j4 = indices2[item2];
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/qualification_reasons",schemaPath:"#/properties/groups/items/properties/qualification_reasons/uniqueItems",keyword:"uniqueItems",params:{i: i10, j: j4},message:"must NOT have duplicate items (items ## "+j4+" and "+i10+" are identical)"}];
return false;
break;
}
indices2[item2] = i10;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/groups/" + i8+"/qualification_reasons",schemaPath:"#/properties/groups/items/properties/qualification_reasons/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid35 = _errs217 === errors;
}
else {
var valid35 = true;
}
}
}
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/groups/" + i8,schemaPath:"#/properties/groups/items/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid34 = _errs170 === errors;
if(!valid34){
break;
}
}
}
}
}
else {
validate10.errors = [{instancePath:instancePath+"/groups",schemaPath:"#/properties/groups/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid0 = _errs168 === errors;
}
else {
var valid0 = true;
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
else {
validate10.errors = [{instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
validate10.errors = vErrors;
return errors === 0;
}

export const validateSectorWindowMeasurements = validate11;
const schema12 = {"type":"object","properties":{"schema":{"const":"leadership_rotation_context.sector_window_measurements/v1"},"status":{"enum":["available","partial","unavailable"]},"reason":{"anyOf":[{"enum":["empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]},"units":{"const":"pct"},"price_basis":{"const":"total_return"},"benchmark":{"type":"string","pattern":"^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])","not":{"enum":["UNKNOWN","NONE","NULL"]}},"cohort_id":{"const":"us_sectors_11"},"population":{"const":"eleven_sector_etf_proxies"},"source_session":{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},"end_session":{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},"windows_sessions":{"const":[5,20,63]},"endpoint_definition":{"const":"Endpoint return: P(T)/P(S_N) - 1, where T is the explicit end session and S_N is the canonical US session exactly N positions before T, so a 5-session return spans 6 session endpoints. Relative wealth is (1+R_group)/(1+R_benchmark) - 1 -- a wealth ratio, never a return difference. Interior gaps never move an endpoint; they are disclosed as observed coverage. Prices are strictly positive, finite, total-return adjusted closes read at the two endpoints only."},"clocks":{"type":"object","properties":{"publication":{"anyOf":[{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"availability":{"anyOf":[{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"correction":{"anyOf":[{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"history":{"anyOf":[{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]}},"required":["publication","availability","correction","history"],"additionalProperties":false},"source_roots":{"type":"array","items":{"type":"string","minLength":1,"maxLength":256,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},"maxItems":32},"receipt":{"anyOf":[{"type":"object"},{"type":"null"}]},"limitations":{"type":"object","properties":{"availability":{"anyOf":[{"type":"object","properties":{"status":{"const":"unknown"},"reason":{"const":"owner_availability_clock_not_supplied"}},"required":["status","reason"],"additionalProperties":false},{"type":"object","properties":{"status":{"const":"supplied"},"clock":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"}},"required":["status","clock"],"additionalProperties":false}]},"publication":{"anyOf":[{"type":"object","properties":{"status":{"const":"unknown"},"reason":{"const":"owner_publication_clock_not_supplied"}},"required":["status","reason"],"additionalProperties":false},{"type":"object","properties":{"status":{"const":"supplied"},"clock":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"}},"required":["status","clock"],"additionalProperties":false}]},"history":{"anyOf":[{"type":"object","properties":{"status":{"const":"unknown"},"reason":{"const":"owner_history_clock_not_supplied"}},"required":["status","reason"],"additionalProperties":false},{"type":"object","properties":{"status":{"const":"supplied"},"clock":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"}},"required":["status","clock"],"additionalProperties":false}]},"corrections":{"type":"object","properties":{"status":{"const":"unavailable"},"reason":{"const":"native_revision_selection_not_supplied"}},"required":["status","reason"],"additionalProperties":false},"freshness":{"type":"object","properties":{"status":{"const":"unverified"},"reason":{"const":"owner_freshness_receipt_not_supplied"}},"required":["status","reason"],"additionalProperties":false},"point_in_time":{"type":"object","properties":{"status":{"const":"not_qualified"},"reason":{"const":"point_in_time_admission_not_supplied"}},"required":["status","reason"],"additionalProperties":false}},"required":["availability","publication","history","corrections","freshness","point_in_time"],"additionalProperties":false},"windows":{"type":"object","properties":{"5":{"type":"object","properties":{"window_sessions":{"const":5},"status":{"enum":["available","partial","unavailable"]},"start_session":{"anyOf":[{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},{"type":"null"}]},"end_session":{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},"benchmark_return_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"benchmark_null_reason":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]},"benchmark_coverage":{"type":"object","properties":{"observed_n":{"type":"integer","minimum":0,"maximum":64},"expected_n":{"type":"integer","minimum":0,"maximum":64},"ratio":{"type":"number","minimum":0,"maximum":1}},"required":["observed_n","expected_n","ratio"],"additionalProperties":false},"null_reason":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]}},"required":["window_sessions","status","start_session","end_session","benchmark_return_pct","benchmark_null_reason","benchmark_coverage","null_reason"],"additionalProperties":false},"20":{"type":"object","properties":{"window_sessions":{"const":20},"status":{"enum":["available","partial","unavailable"]},"start_session":{"anyOf":[{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},{"type":"null"}]},"end_session":{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},"benchmark_return_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"benchmark_null_reason":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]},"benchmark_coverage":{"type":"object","properties":{"observed_n":{"type":"integer","minimum":0,"maximum":64},"expected_n":{"type":"integer","minimum":0,"maximum":64},"ratio":{"type":"number","minimum":0,"maximum":1}},"required":["observed_n","expected_n","ratio"],"additionalProperties":false},"null_reason":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]}},"required":["window_sessions","status","start_session","end_session","benchmark_return_pct","benchmark_null_reason","benchmark_coverage","null_reason"],"additionalProperties":false},"63":{"type":"object","properties":{"window_sessions":{"const":63},"status":{"enum":["available","partial","unavailable"]},"start_session":{"anyOf":[{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},{"type":"null"}]},"end_session":{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},"benchmark_return_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"benchmark_null_reason":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]},"benchmark_coverage":{"type":"object","properties":{"observed_n":{"type":"integer","minimum":0,"maximum":64},"expected_n":{"type":"integer","minimum":0,"maximum":64},"ratio":{"type":"number","minimum":0,"maximum":1}},"required":["observed_n","expected_n","ratio"],"additionalProperties":false},"null_reason":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]}},"required":["window_sessions","status","start_session","end_session","benchmark_return_pct","benchmark_null_reason","benchmark_coverage","null_reason"],"additionalProperties":false}},"required":["5","20","63"],"additionalProperties":false},"groups":{"type":"array","minItems":11,"maxItems":11,"items":{"type":"object","properties":{"group_id":{"enum":["XLB","XLC","XLE","XLF","XLI","XLK","XLP","XLRE","XLU","XLV","XLY"]},"name_en":{"anyOf":[{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"name_zh":{"anyOf":[{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},{"type":"null"}]},"windows":{"type":"object","properties":{"5":{"type":"object","properties":{"status":{"enum":["available","partial","unavailable"]},"absolute_return_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"relative_wealth_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"null_reasons":{"type":"object","properties":{"absolute_return_pct":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]},"relative_wealth_pct":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]}},"required":["absolute_return_pct","relative_wealth_pct"],"additionalProperties":false},"coverage":{"type":"object","properties":{"observed_n":{"type":"integer","minimum":0,"maximum":64},"expected_n":{"type":"integer","minimum":0,"maximum":64},"ratio":{"type":"number","minimum":0,"maximum":1}},"required":["observed_n","expected_n","ratio"],"additionalProperties":false}},"required":["status","absolute_return_pct","relative_wealth_pct","null_reasons","coverage"],"additionalProperties":false},"20":{"type":"object","properties":{"status":{"enum":["available","partial","unavailable"]},"absolute_return_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"relative_wealth_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"null_reasons":{"type":"object","properties":{"absolute_return_pct":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]},"relative_wealth_pct":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]}},"required":["absolute_return_pct","relative_wealth_pct"],"additionalProperties":false},"coverage":{"type":"object","properties":{"observed_n":{"type":"integer","minimum":0,"maximum":64},"expected_n":{"type":"integer","minimum":0,"maximum":64},"ratio":{"type":"number","minimum":0,"maximum":1}},"required":["observed_n","expected_n","ratio"],"additionalProperties":false}},"required":["status","absolute_return_pct","relative_wealth_pct","null_reasons","coverage"],"additionalProperties":false},"63":{"type":"object","properties":{"status":{"enum":["available","partial","unavailable"]},"absolute_return_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"relative_wealth_pct":{"anyOf":[{"type":"number","minimum":-100},{"type":"null"}]},"null_reasons":{"type":"object","properties":{"absolute_return_pct":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]},"relative_wealth_pct":{"anyOf":[{"enum":["missing_input","non_finite_input","invalid_price","benchmark_missing","benchmark_invalid","insufficient_reference_history","empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},{"type":"null"}]}},"required":["absolute_return_pct","relative_wealth_pct"],"additionalProperties":false},"coverage":{"type":"object","properties":{"observed_n":{"type":"integer","minimum":0,"maximum":64},"expected_n":{"type":"integer","minimum":0,"maximum":64},"ratio":{"type":"number","minimum":0,"maximum":1}},"required":["observed_n","expected_n","ratio"],"additionalProperties":false}},"required":["status","absolute_return_pct","relative_wealth_pct","null_reasons","coverage"],"additionalProperties":false}},"required":["5","20","63"],"additionalProperties":false}},"required":["group_id","name_en","name_zh","windows"],"additionalProperties":false}},"diagnostics":{"type":"object","properties":{"panel_rows":{"type":"integer","minimum":0,"maximum":20000},"malformed_rows":{"type":"integer","minimum":0,"maximum":1000000000},"duplicate_sessions":{"type":"array","items":{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},"maxItems":16},"ambiguous_columns":{"type":"array","items":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},"maxItems":16},"columns":{"type":"array","items":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"},"maxItems":64},"binding_keys":{"type":"array","items":{"enum":["source_roots","clocks","receipt","cohort_id","benchmark","source_session","price_basis"]},"maxItems":8,"uniqueItems":true},"receipt_withheld":{"type":"boolean"},"future_tail_sessions":{"type":"array","items":{"type":"string","format":"date","pattern":"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},"maxItems":16},"expected_columns":{"const":12},"qualification_reasons":{"type":"array","items":{"enum":["empty_panel","future_tail","source_session_mismatch","ambiguous_duplicate_price_index","ambiguous_duplicate_column","cohort_identity_mismatch","benchmark_identity_mismatch","return_basis_not_qualified"]},"maxItems":8,"uniqueItems":true},"measured_cells":{"type":"integer","minimum":0,"maximum":33},"complete_cells":{"type":"integer","minimum":0,"maximum":33},"total_cells":{"const":33},"coverage_note":{"type":"string","minLength":1,"maxLength":512,"pattern":"^[^\\u0000-\\u001f]+(?![\\s\\S])"}},"required":["panel_rows","malformed_rows","duplicate_sessions","ambiguous_columns","columns","binding_keys","receipt_withheld","future_tail_sessions","expected_columns","qualification_reasons","measured_cells","complete_cells","total_cells","coverage_note"],"additionalProperties":false},"authority":{"type":"object","properties":{"may_rank":{"const":false},"may_gate":{"const":false},"may_size":{"const":false},"may_trade":{"const":false},"may_escalate":{"const":false}},"required":["may_rank","may_gate","may_size","may_trade","may_escalate"],"additionalProperties":false}},"required":["schema","status","reason","units","price_basis","benchmark","cohort_id","population","source_session","end_session","windows_sessions","endpoint_definition","clocks","source_roots","receipt","limitations","windows","groups","diagnostics","authority"],"additionalProperties":false};
const pattern12 = new RegExp("^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])", "u");

function validate11(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(errors === 0){
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((((((((((((((((((((((data.schema === undefined) || (!(func0.call(data, "schema")))) && (missing0 = "schema")) || (((data.status === undefined) || (!(func0.call(data, "status")))) && (missing0 = "status"))) || (((data.reason === undefined) || (!(func0.call(data, "reason")))) && (missing0 = "reason"))) || (((data.units === undefined) || (!(func0.call(data, "units")))) && (missing0 = "units"))) || (((data.price_basis === undefined) || (!(func0.call(data, "price_basis")))) && (missing0 = "price_basis"))) || (((data.benchmark === undefined) || (!(func0.call(data, "benchmark")))) && (missing0 = "benchmark"))) || (((data.cohort_id === undefined) || (!(func0.call(data, "cohort_id")))) && (missing0 = "cohort_id"))) || (((data.population === undefined) || (!(func0.call(data, "population")))) && (missing0 = "population"))) || (((data.source_session === undefined) || (!(func0.call(data, "source_session")))) && (missing0 = "source_session"))) || (((data.end_session === undefined) || (!(func0.call(data, "end_session")))) && (missing0 = "end_session"))) || (((data.windows_sessions === undefined) || (!(func0.call(data, "windows_sessions")))) && (missing0 = "windows_sessions"))) || (((data.endpoint_definition === undefined) || (!(func0.call(data, "endpoint_definition")))) && (missing0 = "endpoint_definition"))) || (((data.clocks === undefined) || (!(func0.call(data, "clocks")))) && (missing0 = "clocks"))) || (((data.source_roots === undefined) || (!(func0.call(data, "source_roots")))) && (missing0 = "source_roots"))) || (((data.receipt === undefined) || (!(func0.call(data, "receipt")))) && (missing0 = "receipt"))) || (((data.limitations === undefined) || (!(func0.call(data, "limitations")))) && (missing0 = "limitations"))) || (((data.windows === undefined) || (!(func0.call(data, "windows")))) && (missing0 = "windows"))) || (((data.groups === undefined) || (!(func0.call(data, "groups")))) && (missing0 = "groups"))) || (((data.diagnostics === undefined) || (!(func0.call(data, "diagnostics")))) && (missing0 = "diagnostics"))) || (((data.authority === undefined) || (!(func0.call(data, "authority")))) && (missing0 = "authority"))){
validate11.errors = [{instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: missing0},message:"must have required property '"+missing0+"'"}];
return false;
}
else {
const _errs1 = errors;
for(const key0 of Object.keys(data)){
if(!(func0.call(schema12.properties, key0))){
validate11.errors = [{instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs1 === errors){
if(data.schema !== undefined && func0.call(data, "schema")){
const _errs2 = errors;
if("leadership_rotation_context.sector_window_measurements/v1" !== data.schema){
validate11.errors = [{instancePath:instancePath+"/schema",schemaPath:"#/properties/schema/const",keyword:"const",params:{allowedValue: "leadership_rotation_context.sector_window_measurements/v1"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs2 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.status !== undefined && func0.call(data, "status")){
let data1 = data.status;
const _errs3 = errors;
if(!(((data1 === "available") || (data1 === "partial")) || (data1 === "unavailable"))){
validate11.errors = [{instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema12.properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid0 = _errs3 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.reason !== undefined && func0.call(data, "reason")){
let data2 = data.reason;
const _errs4 = errors;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if(!((((((((data2 === "empty_panel") || (data2 === "future_tail")) || (data2 === "source_session_mismatch")) || (data2 === "ambiguous_duplicate_price_index")) || (data2 === "ambiguous_duplicate_column")) || (data2 === "cohort_identity_mismatch")) || (data2 === "benchmark_identity_mismatch")) || (data2 === "return_basis_not_qualified"))){
const err0 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.reason.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs7 = errors;
if(data2 !== null){
const err1 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
var _valid0 = _errs7 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err2 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs5;
if(vErrors !== null){
if(_errs5){
vErrors.length = _errs5;
}
else {
vErrors = null;
}
}
}
var valid0 = _errs4 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.units !== undefined && func0.call(data, "units")){
const _errs9 = errors;
if("pct" !== data.units){
validate11.errors = [{instancePath:instancePath+"/units",schemaPath:"#/properties/units/const",keyword:"const",params:{allowedValue: "pct"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs9 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.price_basis !== undefined && func0.call(data, "price_basis")){
const _errs10 = errors;
if("total_return" !== data.price_basis){
validate11.errors = [{instancePath:instancePath+"/price_basis",schemaPath:"#/properties/price_basis/const",keyword:"const",params:{allowedValue: "total_return"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs10 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.benchmark !== undefined && func0.call(data, "benchmark")){
let data5 = data.benchmark;
const _errs11 = errors;
const _errs13 = errors;
const _errs14 = errors;
if(!(((data5 === "UNKNOWN") || (data5 === "NONE")) || (data5 === "NULL"))){
const err3 = {};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
var valid2 = _errs14 === errors;
if(valid2){
validate11.errors = [{instancePath:instancePath+"/benchmark",schemaPath:"#/properties/benchmark/not",keyword:"not",params:{},message:"must NOT be valid"}];
return false;
}
else {
errors = _errs13;
if(vErrors !== null){
if(_errs13){
vErrors.length = _errs13;
}
else {
vErrors = null;
}
}
}
if(errors === _errs11){
if(typeof data5 === "string"){
if(!pattern1.test(data5)){
validate11.errors = [{instancePath:instancePath+"/benchmark",schemaPath:"#/properties/benchmark/pattern",keyword:"pattern",params:{pattern: "^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])"},message:"must match pattern \""+"^[A-Z][A-Z0-9.^-]{0,15}(?![\\s\\S])"+"\""}];
return false;
}
}
else {
validate11.errors = [{instancePath:instancePath+"/benchmark",schemaPath:"#/properties/benchmark/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
var valid0 = _errs11 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.cohort_id !== undefined && func0.call(data, "cohort_id")){
const _errs15 = errors;
if("us_sectors_11" !== data.cohort_id){
validate11.errors = [{instancePath:instancePath+"/cohort_id",schemaPath:"#/properties/cohort_id/const",keyword:"const",params:{allowedValue: "us_sectors_11"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs15 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.population !== undefined && func0.call(data, "population")){
const _errs16 = errors;
if("eleven_sector_etf_proxies" !== data.population){
validate11.errors = [{instancePath:instancePath+"/population",schemaPath:"#/properties/population/const",keyword:"const",params:{allowedValue: "eleven_sector_etf_proxies"},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs16 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.source_session !== undefined && func0.call(data, "source_session")){
let data8 = data.source_session;
const _errs17 = errors;
if(errors === _errs17){
if(errors === _errs17){
if(typeof data8 === "string"){
if(!pattern12.test(data8)){
validate11.errors = [{instancePath:instancePath+"/source_session",schemaPath:"#/properties/source_session/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""}];
return false;
}
else {
if(!(formats0.validate(data8))){
validate11.errors = [{instancePath:instancePath+"/source_session",schemaPath:"#/properties/source_session/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/source_session",schemaPath:"#/properties/source_session/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
}
var valid0 = _errs17 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.end_session !== undefined && func0.call(data, "end_session")){
let data9 = data.end_session;
const _errs19 = errors;
if(errors === _errs19){
if(errors === _errs19){
if(typeof data9 === "string"){
if(!pattern12.test(data9)){
validate11.errors = [{instancePath:instancePath+"/end_session",schemaPath:"#/properties/end_session/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""}];
return false;
}
else {
if(!(formats0.validate(data9))){
validate11.errors = [{instancePath:instancePath+"/end_session",schemaPath:"#/properties/end_session/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/end_session",schemaPath:"#/properties/end_session/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
}
var valid0 = _errs19 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.windows_sessions !== undefined && func0.call(data, "windows_sessions")){
const _errs21 = errors;
if(!func32(data.windows_sessions, schema12.properties.windows_sessions.const)){
validate11.errors = [{instancePath:instancePath+"/windows_sessions",schemaPath:"#/properties/windows_sessions/const",keyword:"const",params:{allowedValue: schema12.properties.windows_sessions.const},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs21 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.endpoint_definition !== undefined && func0.call(data, "endpoint_definition")){
const _errs22 = errors;
if("Endpoint return: P(T)/P(S_N) - 1, where T is the explicit end session and S_N is the canonical US session exactly N positions before T, so a 5-session return spans 6 session endpoints. Relative wealth is (1+R_group)/(1+R_benchmark) - 1 -- a wealth ratio, never a return difference. Interior gaps never move an endpoint; they are disclosed as observed coverage. Prices are strictly positive, finite, total-return adjusted closes read at the two endpoints only." !== data.endpoint_definition){
validate11.errors = [{instancePath:instancePath+"/endpoint_definition",schemaPath:"#/properties/endpoint_definition/const",keyword:"const",params:{allowedValue: "Endpoint return: P(T)/P(S_N) - 1, where T is the explicit end session and S_N is the canonical US session exactly N positions before T, so a 5-session return spans 6 session endpoints. Relative wealth is (1+R_group)/(1+R_benchmark) - 1 -- a wealth ratio, never a return difference. Interior gaps never move an endpoint; they are disclosed as observed coverage. Prices are strictly positive, finite, total-return adjusted closes read at the two endpoints only."},message:"must be equal to constant"}];
return false;
}
var valid0 = _errs22 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.clocks !== undefined && func0.call(data, "clocks")){
let data12 = data.clocks;
const _errs23 = errors;
if(errors === _errs23){
if(data12 && typeof data12 == "object" && !Array.isArray(data12)){
let missing1;
if((((((data12.publication === undefined) || (!(func0.call(data12, "publication")))) && (missing1 = "publication")) || (((data12.availability === undefined) || (!(func0.call(data12, "availability")))) && (missing1 = "availability"))) || (((data12.correction === undefined) || (!(func0.call(data12, "correction")))) && (missing1 = "correction"))) || (((data12.history === undefined) || (!(func0.call(data12, "history")))) && (missing1 = "history"))){
validate11.errors = [{instancePath:instancePath+"/clocks",schemaPath:"#/properties/clocks/required",keyword:"required",params:{missingProperty: missing1},message:"must have required property '"+missing1+"'"}];
return false;
}
else {
const _errs25 = errors;
for(const key1 of Object.keys(data12)){
if(!((((key1 === "publication") || (key1 === "availability")) || (key1 === "correction")) || (key1 === "history"))){
validate11.errors = [{instancePath:instancePath+"/clocks",schemaPath:"#/properties/clocks/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs25 === errors){
if(data12.publication !== undefined && func0.call(data12, "publication")){
let data13 = data12.publication;
const _errs26 = errors;
const _errs27 = errors;
let valid4 = false;
const _errs28 = errors;
if(errors === _errs28){
if(typeof data13 === "string"){
if(func97(data13) > 64){
const err4 = {instancePath:instancePath+"/clocks/publication",schemaPath:"#/properties/clocks/properties/publication/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
else {
if(func97(data13) < 1){
const err5 = {instancePath:instancePath+"/clocks/publication",schemaPath:"#/properties/clocks/properties/publication/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
if(!pattern2.test(data13)){
const err6 = {instancePath:instancePath+"/clocks/publication",schemaPath:"#/properties/clocks/properties/publication/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
}
else {
const err7 = {instancePath:instancePath+"/clocks/publication",schemaPath:"#/properties/clocks/properties/publication/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
var _valid1 = _errs28 === errors;
valid4 = valid4 || _valid1;
if(!valid4){
const _errs30 = errors;
if(data13 !== null){
const err8 = {instancePath:instancePath+"/clocks/publication",schemaPath:"#/properties/clocks/properties/publication/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var _valid1 = _errs30 === errors;
valid4 = valid4 || _valid1;
}
if(!valid4){
const err9 = {instancePath:instancePath+"/clocks/publication",schemaPath:"#/properties/clocks/properties/publication/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs27;
if(vErrors !== null){
if(_errs27){
vErrors.length = _errs27;
}
else {
vErrors = null;
}
}
}
var valid3 = _errs26 === errors;
}
else {
var valid3 = true;
}
if(valid3){
if(data12.availability !== undefined && func0.call(data12, "availability")){
let data14 = data12.availability;
const _errs32 = errors;
const _errs33 = errors;
let valid5 = false;
const _errs34 = errors;
if(errors === _errs34){
if(typeof data14 === "string"){
if(func97(data14) > 64){
const err10 = {instancePath:instancePath+"/clocks/availability",schemaPath:"#/properties/clocks/properties/availability/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
else {
if(func97(data14) < 1){
const err11 = {instancePath:instancePath+"/clocks/availability",schemaPath:"#/properties/clocks/properties/availability/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
else {
if(!pattern2.test(data14)){
const err12 = {instancePath:instancePath+"/clocks/availability",schemaPath:"#/properties/clocks/properties/availability/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
}
else {
const err13 = {instancePath:instancePath+"/clocks/availability",schemaPath:"#/properties/clocks/properties/availability/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
var _valid2 = _errs34 === errors;
valid5 = valid5 || _valid2;
if(!valid5){
const _errs36 = errors;
if(data14 !== null){
const err14 = {instancePath:instancePath+"/clocks/availability",schemaPath:"#/properties/clocks/properties/availability/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
var _valid2 = _errs36 === errors;
valid5 = valid5 || _valid2;
}
if(!valid5){
const err15 = {instancePath:instancePath+"/clocks/availability",schemaPath:"#/properties/clocks/properties/availability/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs33;
if(vErrors !== null){
if(_errs33){
vErrors.length = _errs33;
}
else {
vErrors = null;
}
}
}
var valid3 = _errs32 === errors;
}
else {
var valid3 = true;
}
if(valid3){
if(data12.correction !== undefined && func0.call(data12, "correction")){
let data15 = data12.correction;
const _errs38 = errors;
const _errs39 = errors;
let valid6 = false;
const _errs40 = errors;
if(errors === _errs40){
if(typeof data15 === "string"){
if(func97(data15) > 64){
const err16 = {instancePath:instancePath+"/clocks/correction",schemaPath:"#/properties/clocks/properties/correction/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
else {
if(func97(data15) < 1){
const err17 = {instancePath:instancePath+"/clocks/correction",schemaPath:"#/properties/clocks/properties/correction/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
else {
if(!pattern2.test(data15)){
const err18 = {instancePath:instancePath+"/clocks/correction",schemaPath:"#/properties/clocks/properties/correction/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
}
else {
const err19 = {instancePath:instancePath+"/clocks/correction",schemaPath:"#/properties/clocks/properties/correction/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
var _valid3 = _errs40 === errors;
valid6 = valid6 || _valid3;
if(!valid6){
const _errs42 = errors;
if(data15 !== null){
const err20 = {instancePath:instancePath+"/clocks/correction",schemaPath:"#/properties/clocks/properties/correction/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
var _valid3 = _errs42 === errors;
valid6 = valid6 || _valid3;
}
if(!valid6){
const err21 = {instancePath:instancePath+"/clocks/correction",schemaPath:"#/properties/clocks/properties/correction/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs39;
if(vErrors !== null){
if(_errs39){
vErrors.length = _errs39;
}
else {
vErrors = null;
}
}
}
var valid3 = _errs38 === errors;
}
else {
var valid3 = true;
}
if(valid3){
if(data12.history !== undefined && func0.call(data12, "history")){
let data16 = data12.history;
const _errs44 = errors;
const _errs45 = errors;
let valid7 = false;
const _errs46 = errors;
if(errors === _errs46){
if(typeof data16 === "string"){
if(func97(data16) > 64){
const err22 = {instancePath:instancePath+"/clocks/history",schemaPath:"#/properties/clocks/properties/history/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
else {
if(func97(data16) < 1){
const err23 = {instancePath:instancePath+"/clocks/history",schemaPath:"#/properties/clocks/properties/history/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
else {
if(!pattern2.test(data16)){
const err24 = {instancePath:instancePath+"/clocks/history",schemaPath:"#/properties/clocks/properties/history/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
}
else {
const err25 = {instancePath:instancePath+"/clocks/history",schemaPath:"#/properties/clocks/properties/history/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
var _valid4 = _errs46 === errors;
valid7 = valid7 || _valid4;
if(!valid7){
const _errs48 = errors;
if(data16 !== null){
const err26 = {instancePath:instancePath+"/clocks/history",schemaPath:"#/properties/clocks/properties/history/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
var _valid4 = _errs48 === errors;
valid7 = valid7 || _valid4;
}
if(!valid7){
const err27 = {instancePath:instancePath+"/clocks/history",schemaPath:"#/properties/clocks/properties/history/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs45;
if(vErrors !== null){
if(_errs45){
vErrors.length = _errs45;
}
else {
vErrors = null;
}
}
}
var valid3 = _errs44 === errors;
}
else {
var valid3 = true;
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/clocks",schemaPath:"#/properties/clocks/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs23 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.source_roots !== undefined && func0.call(data, "source_roots")){
let data17 = data.source_roots;
const _errs50 = errors;
if(errors === _errs50){
if(Array.isArray(data17)){
if(data17.length > 32){
validate11.errors = [{instancePath:instancePath+"/source_roots",schemaPath:"#/properties/source_roots/maxItems",keyword:"maxItems",params:{limit: 32},message:"must NOT have more than 32 items"}];
return false;
}
else {
var valid8 = true;
const len0 = data17.length;
for(let i0=0; i0<len0; i0++){
let data18 = data17[i0];
const _errs52 = errors;
if(errors === _errs52){
if(typeof data18 === "string"){
if(func97(data18) > 256){
validate11.errors = [{instancePath:instancePath+"/source_roots/" + i0,schemaPath:"#/properties/source_roots/items/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"}];
return false;
}
else {
if(func97(data18) < 1){
validate11.errors = [{instancePath:instancePath+"/source_roots/" + i0,schemaPath:"#/properties/source_roots/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"}];
return false;
}
else {
if(!pattern2.test(data18)){
validate11.errors = [{instancePath:instancePath+"/source_roots/" + i0,schemaPath:"#/properties/source_roots/items/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""}];
return false;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/source_roots/" + i0,schemaPath:"#/properties/source_roots/items/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
var valid8 = _errs52 === errors;
if(!valid8){
break;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/source_roots",schemaPath:"#/properties/source_roots/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid0 = _errs50 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.receipt !== undefined && func0.call(data, "receipt")){
let data19 = data.receipt;
const _errs54 = errors;
const _errs55 = errors;
let valid9 = false;
const _errs56 = errors;
if(!(data19 && typeof data19 == "object" && !Array.isArray(data19))){
const err28 = {instancePath:instancePath+"/receipt",schemaPath:"#/properties/receipt/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
var _valid5 = _errs56 === errors;
valid9 = valid9 || _valid5;
if(!valid9){
const _errs58 = errors;
if(data19 !== null){
const err29 = {instancePath:instancePath+"/receipt",schemaPath:"#/properties/receipt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
var _valid5 = _errs58 === errors;
valid9 = valid9 || _valid5;
}
if(!valid9){
const err30 = {instancePath:instancePath+"/receipt",schemaPath:"#/properties/receipt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs55;
if(vErrors !== null){
if(_errs55){
vErrors.length = _errs55;
}
else {
vErrors = null;
}
}
}
var valid0 = _errs54 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.limitations !== undefined && func0.call(data, "limitations")){
let data20 = data.limitations;
const _errs60 = errors;
if(errors === _errs60){
if(data20 && typeof data20 == "object" && !Array.isArray(data20)){
let missing2;
if((((((((data20.availability === undefined) || (!(func0.call(data20, "availability")))) && (missing2 = "availability")) || (((data20.publication === undefined) || (!(func0.call(data20, "publication")))) && (missing2 = "publication"))) || (((data20.history === undefined) || (!(func0.call(data20, "history")))) && (missing2 = "history"))) || (((data20.corrections === undefined) || (!(func0.call(data20, "corrections")))) && (missing2 = "corrections"))) || (((data20.freshness === undefined) || (!(func0.call(data20, "freshness")))) && (missing2 = "freshness"))) || (((data20.point_in_time === undefined) || (!(func0.call(data20, "point_in_time")))) && (missing2 = "point_in_time"))){
validate11.errors = [{instancePath:instancePath+"/limitations",schemaPath:"#/properties/limitations/required",keyword:"required",params:{missingProperty: missing2},message:"must have required property '"+missing2+"'"}];
return false;
}
else {
const _errs62 = errors;
for(const key2 of Object.keys(data20)){
if(!((((((key2 === "availability") || (key2 === "publication")) || (key2 === "history")) || (key2 === "corrections")) || (key2 === "freshness")) || (key2 === "point_in_time"))){
validate11.errors = [{instancePath:instancePath+"/limitations",schemaPath:"#/properties/limitations/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs62 === errors){
if(data20.availability !== undefined && func0.call(data20, "availability")){
let data21 = data20.availability;
const _errs63 = errors;
const _errs64 = errors;
let valid11 = false;
const _errs65 = errors;
if(errors === _errs65){
if(data21 && typeof data21 == "object" && !Array.isArray(data21)){
let missing3;
if((((data21.status === undefined) || (!(func0.call(data21, "status")))) && (missing3 = "status")) || (((data21.reason === undefined) || (!(func0.call(data21, "reason")))) && (missing3 = "reason"))){
const err31 = {instancePath:instancePath+"/limitations/availability",schemaPath:"#/properties/limitations/properties/availability/anyOf/0/required",keyword:"required",params:{missingProperty: missing3},message:"must have required property '"+missing3+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
else {
const _errs67 = errors;
for(const key3 of Object.keys(data21)){
if(!((key3 === "status") || (key3 === "reason"))){
const err32 = {instancePath:instancePath+"/limitations/availability",schemaPath:"#/properties/limitations/properties/availability/anyOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
break;
}
}
if(_errs67 === errors){
if(data21.status !== undefined && func0.call(data21, "status")){
const _errs68 = errors;
if("unknown" !== data21.status){
const err33 = {instancePath:instancePath+"/limitations/availability/status",schemaPath:"#/properties/limitations/properties/availability/anyOf/0/properties/status/const",keyword:"const",params:{allowedValue: "unknown"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
var valid12 = _errs68 === errors;
}
else {
var valid12 = true;
}
if(valid12){
if(data21.reason !== undefined && func0.call(data21, "reason")){
const _errs69 = errors;
if("owner_availability_clock_not_supplied" !== data21.reason){
const err34 = {instancePath:instancePath+"/limitations/availability/reason",schemaPath:"#/properties/limitations/properties/availability/anyOf/0/properties/reason/const",keyword:"const",params:{allowedValue: "owner_availability_clock_not_supplied"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
var valid12 = _errs69 === errors;
}
else {
var valid12 = true;
}
}
}
}
}
else {
const err35 = {instancePath:instancePath+"/limitations/availability",schemaPath:"#/properties/limitations/properties/availability/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
var _valid6 = _errs65 === errors;
valid11 = valid11 || _valid6;
if(!valid11){
const _errs70 = errors;
if(errors === _errs70){
if(data21 && typeof data21 == "object" && !Array.isArray(data21)){
let missing4;
if((((data21.status === undefined) || (!(func0.call(data21, "status")))) && (missing4 = "status")) || (((data21.clock === undefined) || (!(func0.call(data21, "clock")))) && (missing4 = "clock"))){
const err36 = {instancePath:instancePath+"/limitations/availability",schemaPath:"#/properties/limitations/properties/availability/anyOf/1/required",keyword:"required",params:{missingProperty: missing4},message:"must have required property '"+missing4+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
else {
const _errs72 = errors;
for(const key4 of Object.keys(data21)){
if(!((key4 === "status") || (key4 === "clock"))){
const err37 = {instancePath:instancePath+"/limitations/availability",schemaPath:"#/properties/limitations/properties/availability/anyOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
break;
}
}
if(_errs72 === errors){
if(data21.status !== undefined && func0.call(data21, "status")){
const _errs73 = errors;
if("supplied" !== data21.status){
const err38 = {instancePath:instancePath+"/limitations/availability/status",schemaPath:"#/properties/limitations/properties/availability/anyOf/1/properties/status/const",keyword:"const",params:{allowedValue: "supplied"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
var valid13 = _errs73 === errors;
}
else {
var valid13 = true;
}
if(valid13){
if(data21.clock !== undefined && func0.call(data21, "clock")){
let data25 = data21.clock;
const _errs74 = errors;
if(errors === _errs74){
if(typeof data25 === "string"){
if(func97(data25) > 64){
const err39 = {instancePath:instancePath+"/limitations/availability/clock",schemaPath:"#/properties/limitations/properties/availability/anyOf/1/properties/clock/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
else {
if(func97(data25) < 1){
const err40 = {instancePath:instancePath+"/limitations/availability/clock",schemaPath:"#/properties/limitations/properties/availability/anyOf/1/properties/clock/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
else {
if(!pattern2.test(data25)){
const err41 = {instancePath:instancePath+"/limitations/availability/clock",schemaPath:"#/properties/limitations/properties/availability/anyOf/1/properties/clock/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
}
}
else {
const err42 = {instancePath:instancePath+"/limitations/availability/clock",schemaPath:"#/properties/limitations/properties/availability/anyOf/1/properties/clock/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
var valid13 = _errs74 === errors;
}
else {
var valid13 = true;
}
}
}
}
}
else {
const err43 = {instancePath:instancePath+"/limitations/availability",schemaPath:"#/properties/limitations/properties/availability/anyOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
var _valid6 = _errs70 === errors;
valid11 = valid11 || _valid6;
}
if(!valid11){
const err44 = {instancePath:instancePath+"/limitations/availability",schemaPath:"#/properties/limitations/properties/availability/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs64;
if(vErrors !== null){
if(_errs64){
vErrors.length = _errs64;
}
else {
vErrors = null;
}
}
}
var valid10 = _errs63 === errors;
}
else {
var valid10 = true;
}
if(valid10){
if(data20.publication !== undefined && func0.call(data20, "publication")){
let data26 = data20.publication;
const _errs76 = errors;
const _errs77 = errors;
let valid14 = false;
const _errs78 = errors;
if(errors === _errs78){
if(data26 && typeof data26 == "object" && !Array.isArray(data26)){
let missing5;
if((((data26.status === undefined) || (!(func0.call(data26, "status")))) && (missing5 = "status")) || (((data26.reason === undefined) || (!(func0.call(data26, "reason")))) && (missing5 = "reason"))){
const err45 = {instancePath:instancePath+"/limitations/publication",schemaPath:"#/properties/limitations/properties/publication/anyOf/0/required",keyword:"required",params:{missingProperty: missing5},message:"must have required property '"+missing5+"'"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
else {
const _errs80 = errors;
for(const key5 of Object.keys(data26)){
if(!((key5 === "status") || (key5 === "reason"))){
const err46 = {instancePath:instancePath+"/limitations/publication",schemaPath:"#/properties/limitations/properties/publication/anyOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
break;
}
}
if(_errs80 === errors){
if(data26.status !== undefined && func0.call(data26, "status")){
const _errs81 = errors;
if("unknown" !== data26.status){
const err47 = {instancePath:instancePath+"/limitations/publication/status",schemaPath:"#/properties/limitations/properties/publication/anyOf/0/properties/status/const",keyword:"const",params:{allowedValue: "unknown"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
var valid15 = _errs81 === errors;
}
else {
var valid15 = true;
}
if(valid15){
if(data26.reason !== undefined && func0.call(data26, "reason")){
const _errs82 = errors;
if("owner_publication_clock_not_supplied" !== data26.reason){
const err48 = {instancePath:instancePath+"/limitations/publication/reason",schemaPath:"#/properties/limitations/properties/publication/anyOf/0/properties/reason/const",keyword:"const",params:{allowedValue: "owner_publication_clock_not_supplied"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
var valid15 = _errs82 === errors;
}
else {
var valid15 = true;
}
}
}
}
}
else {
const err49 = {instancePath:instancePath+"/limitations/publication",schemaPath:"#/properties/limitations/properties/publication/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
var _valid7 = _errs78 === errors;
valid14 = valid14 || _valid7;
if(!valid14){
const _errs83 = errors;
if(errors === _errs83){
if(data26 && typeof data26 == "object" && !Array.isArray(data26)){
let missing6;
if((((data26.status === undefined) || (!(func0.call(data26, "status")))) && (missing6 = "status")) || (((data26.clock === undefined) || (!(func0.call(data26, "clock")))) && (missing6 = "clock"))){
const err50 = {instancePath:instancePath+"/limitations/publication",schemaPath:"#/properties/limitations/properties/publication/anyOf/1/required",keyword:"required",params:{missingProperty: missing6},message:"must have required property '"+missing6+"'"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
else {
const _errs85 = errors;
for(const key6 of Object.keys(data26)){
if(!((key6 === "status") || (key6 === "clock"))){
const err51 = {instancePath:instancePath+"/limitations/publication",schemaPath:"#/properties/limitations/properties/publication/anyOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
break;
}
}
if(_errs85 === errors){
if(data26.status !== undefined && func0.call(data26, "status")){
const _errs86 = errors;
if("supplied" !== data26.status){
const err52 = {instancePath:instancePath+"/limitations/publication/status",schemaPath:"#/properties/limitations/properties/publication/anyOf/1/properties/status/const",keyword:"const",params:{allowedValue: "supplied"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
var valid16 = _errs86 === errors;
}
else {
var valid16 = true;
}
if(valid16){
if(data26.clock !== undefined && func0.call(data26, "clock")){
let data30 = data26.clock;
const _errs87 = errors;
if(errors === _errs87){
if(typeof data30 === "string"){
if(func97(data30) > 64){
const err53 = {instancePath:instancePath+"/limitations/publication/clock",schemaPath:"#/properties/limitations/properties/publication/anyOf/1/properties/clock/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
else {
if(func97(data30) < 1){
const err54 = {instancePath:instancePath+"/limitations/publication/clock",schemaPath:"#/properties/limitations/properties/publication/anyOf/1/properties/clock/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
else {
if(!pattern2.test(data30)){
const err55 = {instancePath:instancePath+"/limitations/publication/clock",schemaPath:"#/properties/limitations/properties/publication/anyOf/1/properties/clock/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
}
}
else {
const err56 = {instancePath:instancePath+"/limitations/publication/clock",schemaPath:"#/properties/limitations/properties/publication/anyOf/1/properties/clock/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
var valid16 = _errs87 === errors;
}
else {
var valid16 = true;
}
}
}
}
}
else {
const err57 = {instancePath:instancePath+"/limitations/publication",schemaPath:"#/properties/limitations/properties/publication/anyOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
var _valid7 = _errs83 === errors;
valid14 = valid14 || _valid7;
}
if(!valid14){
const err58 = {instancePath:instancePath+"/limitations/publication",schemaPath:"#/properties/limitations/properties/publication/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs77;
if(vErrors !== null){
if(_errs77){
vErrors.length = _errs77;
}
else {
vErrors = null;
}
}
}
var valid10 = _errs76 === errors;
}
else {
var valid10 = true;
}
if(valid10){
if(data20.history !== undefined && func0.call(data20, "history")){
let data31 = data20.history;
const _errs89 = errors;
const _errs90 = errors;
let valid17 = false;
const _errs91 = errors;
if(errors === _errs91){
if(data31 && typeof data31 == "object" && !Array.isArray(data31)){
let missing7;
if((((data31.status === undefined) || (!(func0.call(data31, "status")))) && (missing7 = "status")) || (((data31.reason === undefined) || (!(func0.call(data31, "reason")))) && (missing7 = "reason"))){
const err59 = {instancePath:instancePath+"/limitations/history",schemaPath:"#/properties/limitations/properties/history/anyOf/0/required",keyword:"required",params:{missingProperty: missing7},message:"must have required property '"+missing7+"'"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
else {
const _errs93 = errors;
for(const key7 of Object.keys(data31)){
if(!((key7 === "status") || (key7 === "reason"))){
const err60 = {instancePath:instancePath+"/limitations/history",schemaPath:"#/properties/limitations/properties/history/anyOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key7},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
break;
}
}
if(_errs93 === errors){
if(data31.status !== undefined && func0.call(data31, "status")){
const _errs94 = errors;
if("unknown" !== data31.status){
const err61 = {instancePath:instancePath+"/limitations/history/status",schemaPath:"#/properties/limitations/properties/history/anyOf/0/properties/status/const",keyword:"const",params:{allowedValue: "unknown"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
var valid18 = _errs94 === errors;
}
else {
var valid18 = true;
}
if(valid18){
if(data31.reason !== undefined && func0.call(data31, "reason")){
const _errs95 = errors;
if("owner_history_clock_not_supplied" !== data31.reason){
const err62 = {instancePath:instancePath+"/limitations/history/reason",schemaPath:"#/properties/limitations/properties/history/anyOf/0/properties/reason/const",keyword:"const",params:{allowedValue: "owner_history_clock_not_supplied"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
var valid18 = _errs95 === errors;
}
else {
var valid18 = true;
}
}
}
}
}
else {
const err63 = {instancePath:instancePath+"/limitations/history",schemaPath:"#/properties/limitations/properties/history/anyOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
var _valid8 = _errs91 === errors;
valid17 = valid17 || _valid8;
if(!valid17){
const _errs96 = errors;
if(errors === _errs96){
if(data31 && typeof data31 == "object" && !Array.isArray(data31)){
let missing8;
if((((data31.status === undefined) || (!(func0.call(data31, "status")))) && (missing8 = "status")) || (((data31.clock === undefined) || (!(func0.call(data31, "clock")))) && (missing8 = "clock"))){
const err64 = {instancePath:instancePath+"/limitations/history",schemaPath:"#/properties/limitations/properties/history/anyOf/1/required",keyword:"required",params:{missingProperty: missing8},message:"must have required property '"+missing8+"'"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
else {
const _errs98 = errors;
for(const key8 of Object.keys(data31)){
if(!((key8 === "status") || (key8 === "clock"))){
const err65 = {instancePath:instancePath+"/limitations/history",schemaPath:"#/properties/limitations/properties/history/anyOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key8},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
break;
}
}
if(_errs98 === errors){
if(data31.status !== undefined && func0.call(data31, "status")){
const _errs99 = errors;
if("supplied" !== data31.status){
const err66 = {instancePath:instancePath+"/limitations/history/status",schemaPath:"#/properties/limitations/properties/history/anyOf/1/properties/status/const",keyword:"const",params:{allowedValue: "supplied"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
var valid19 = _errs99 === errors;
}
else {
var valid19 = true;
}
if(valid19){
if(data31.clock !== undefined && func0.call(data31, "clock")){
let data35 = data31.clock;
const _errs100 = errors;
if(errors === _errs100){
if(typeof data35 === "string"){
if(func97(data35) > 64){
const err67 = {instancePath:instancePath+"/limitations/history/clock",schemaPath:"#/properties/limitations/properties/history/anyOf/1/properties/clock/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
else {
if(func97(data35) < 1){
const err68 = {instancePath:instancePath+"/limitations/history/clock",schemaPath:"#/properties/limitations/properties/history/anyOf/1/properties/clock/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
else {
if(!pattern2.test(data35)){
const err69 = {instancePath:instancePath+"/limitations/history/clock",schemaPath:"#/properties/limitations/properties/history/anyOf/1/properties/clock/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
}
}
}
else {
const err70 = {instancePath:instancePath+"/limitations/history/clock",schemaPath:"#/properties/limitations/properties/history/anyOf/1/properties/clock/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
}
var valid19 = _errs100 === errors;
}
else {
var valid19 = true;
}
}
}
}
}
else {
const err71 = {instancePath:instancePath+"/limitations/history",schemaPath:"#/properties/limitations/properties/history/anyOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
}
var _valid8 = _errs96 === errors;
valid17 = valid17 || _valid8;
}
if(!valid17){
const err72 = {instancePath:instancePath+"/limitations/history",schemaPath:"#/properties/limitations/properties/history/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs90;
if(vErrors !== null){
if(_errs90){
vErrors.length = _errs90;
}
else {
vErrors = null;
}
}
}
var valid10 = _errs89 === errors;
}
else {
var valid10 = true;
}
if(valid10){
if(data20.corrections !== undefined && func0.call(data20, "corrections")){
let data36 = data20.corrections;
const _errs102 = errors;
if(errors === _errs102){
if(data36 && typeof data36 == "object" && !Array.isArray(data36)){
let missing9;
if((((data36.status === undefined) || (!(func0.call(data36, "status")))) && (missing9 = "status")) || (((data36.reason === undefined) || (!(func0.call(data36, "reason")))) && (missing9 = "reason"))){
validate11.errors = [{instancePath:instancePath+"/limitations/corrections",schemaPath:"#/properties/limitations/properties/corrections/required",keyword:"required",params:{missingProperty: missing9},message:"must have required property '"+missing9+"'"}];
return false;
}
else {
const _errs104 = errors;
for(const key9 of Object.keys(data36)){
if(!((key9 === "status") || (key9 === "reason"))){
validate11.errors = [{instancePath:instancePath+"/limitations/corrections",schemaPath:"#/properties/limitations/properties/corrections/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key9},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs104 === errors){
if(data36.status !== undefined && func0.call(data36, "status")){
const _errs105 = errors;
if("unavailable" !== data36.status){
validate11.errors = [{instancePath:instancePath+"/limitations/corrections/status",schemaPath:"#/properties/limitations/properties/corrections/properties/status/const",keyword:"const",params:{allowedValue: "unavailable"},message:"must be equal to constant"}];
return false;
}
var valid20 = _errs105 === errors;
}
else {
var valid20 = true;
}
if(valid20){
if(data36.reason !== undefined && func0.call(data36, "reason")){
const _errs106 = errors;
if("native_revision_selection_not_supplied" !== data36.reason){
validate11.errors = [{instancePath:instancePath+"/limitations/corrections/reason",schemaPath:"#/properties/limitations/properties/corrections/properties/reason/const",keyword:"const",params:{allowedValue: "native_revision_selection_not_supplied"},message:"must be equal to constant"}];
return false;
}
var valid20 = _errs106 === errors;
}
else {
var valid20 = true;
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/limitations/corrections",schemaPath:"#/properties/limitations/properties/corrections/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid10 = _errs102 === errors;
}
else {
var valid10 = true;
}
if(valid10){
if(data20.freshness !== undefined && func0.call(data20, "freshness")){
let data39 = data20.freshness;
const _errs107 = errors;
if(errors === _errs107){
if(data39 && typeof data39 == "object" && !Array.isArray(data39)){
let missing10;
if((((data39.status === undefined) || (!(func0.call(data39, "status")))) && (missing10 = "status")) || (((data39.reason === undefined) || (!(func0.call(data39, "reason")))) && (missing10 = "reason"))){
validate11.errors = [{instancePath:instancePath+"/limitations/freshness",schemaPath:"#/properties/limitations/properties/freshness/required",keyword:"required",params:{missingProperty: missing10},message:"must have required property '"+missing10+"'"}];
return false;
}
else {
const _errs109 = errors;
for(const key10 of Object.keys(data39)){
if(!((key10 === "status") || (key10 === "reason"))){
validate11.errors = [{instancePath:instancePath+"/limitations/freshness",schemaPath:"#/properties/limitations/properties/freshness/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key10},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs109 === errors){
if(data39.status !== undefined && func0.call(data39, "status")){
const _errs110 = errors;
if("unverified" !== data39.status){
validate11.errors = [{instancePath:instancePath+"/limitations/freshness/status",schemaPath:"#/properties/limitations/properties/freshness/properties/status/const",keyword:"const",params:{allowedValue: "unverified"},message:"must be equal to constant"}];
return false;
}
var valid21 = _errs110 === errors;
}
else {
var valid21 = true;
}
if(valid21){
if(data39.reason !== undefined && func0.call(data39, "reason")){
const _errs111 = errors;
if("owner_freshness_receipt_not_supplied" !== data39.reason){
validate11.errors = [{instancePath:instancePath+"/limitations/freshness/reason",schemaPath:"#/properties/limitations/properties/freshness/properties/reason/const",keyword:"const",params:{allowedValue: "owner_freshness_receipt_not_supplied"},message:"must be equal to constant"}];
return false;
}
var valid21 = _errs111 === errors;
}
else {
var valid21 = true;
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/limitations/freshness",schemaPath:"#/properties/limitations/properties/freshness/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid10 = _errs107 === errors;
}
else {
var valid10 = true;
}
if(valid10){
if(data20.point_in_time !== undefined && func0.call(data20, "point_in_time")){
let data42 = data20.point_in_time;
const _errs112 = errors;
if(errors === _errs112){
if(data42 && typeof data42 == "object" && !Array.isArray(data42)){
let missing11;
if((((data42.status === undefined) || (!(func0.call(data42, "status")))) && (missing11 = "status")) || (((data42.reason === undefined) || (!(func0.call(data42, "reason")))) && (missing11 = "reason"))){
validate11.errors = [{instancePath:instancePath+"/limitations/point_in_time",schemaPath:"#/properties/limitations/properties/point_in_time/required",keyword:"required",params:{missingProperty: missing11},message:"must have required property '"+missing11+"'"}];
return false;
}
else {
const _errs114 = errors;
for(const key11 of Object.keys(data42)){
if(!((key11 === "status") || (key11 === "reason"))){
validate11.errors = [{instancePath:instancePath+"/limitations/point_in_time",schemaPath:"#/properties/limitations/properties/point_in_time/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key11},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs114 === errors){
if(data42.status !== undefined && func0.call(data42, "status")){
const _errs115 = errors;
if("not_qualified" !== data42.status){
validate11.errors = [{instancePath:instancePath+"/limitations/point_in_time/status",schemaPath:"#/properties/limitations/properties/point_in_time/properties/status/const",keyword:"const",params:{allowedValue: "not_qualified"},message:"must be equal to constant"}];
return false;
}
var valid22 = _errs115 === errors;
}
else {
var valid22 = true;
}
if(valid22){
if(data42.reason !== undefined && func0.call(data42, "reason")){
const _errs116 = errors;
if("point_in_time_admission_not_supplied" !== data42.reason){
validate11.errors = [{instancePath:instancePath+"/limitations/point_in_time/reason",schemaPath:"#/properties/limitations/properties/point_in_time/properties/reason/const",keyword:"const",params:{allowedValue: "point_in_time_admission_not_supplied"},message:"must be equal to constant"}];
return false;
}
var valid22 = _errs116 === errors;
}
else {
var valid22 = true;
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/limitations/point_in_time",schemaPath:"#/properties/limitations/properties/point_in_time/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid10 = _errs112 === errors;
}
else {
var valid10 = true;
}
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/limitations",schemaPath:"#/properties/limitations/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs60 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.windows !== undefined && func0.call(data, "windows")){
let data45 = data.windows;
const _errs117 = errors;
if(errors === _errs117){
if(data45 && typeof data45 == "object" && !Array.isArray(data45)){
let missing12;
if(((((data45["5"] === undefined) || (!(func0.call(data45, "5")))) && (missing12 = "5")) || (((data45["20"] === undefined) || (!(func0.call(data45, "20")))) && (missing12 = "20"))) || (((data45["63"] === undefined) || (!(func0.call(data45, "63")))) && (missing12 = "63"))){
validate11.errors = [{instancePath:instancePath+"/windows",schemaPath:"#/properties/windows/required",keyword:"required",params:{missingProperty: missing12},message:"must have required property '"+missing12+"'"}];
return false;
}
else {
const _errs119 = errors;
for(const key12 of Object.keys(data45)){
if(!(((key12 === "5") || (key12 === "20")) || (key12 === "63"))){
validate11.errors = [{instancePath:instancePath+"/windows",schemaPath:"#/properties/windows/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key12},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs119 === errors){
if(data45["5"] !== undefined && func0.call(data45, "5")){
let data46 = data45["5"];
const _errs120 = errors;
if(errors === _errs120){
if(data46 && typeof data46 == "object" && !Array.isArray(data46)){
let missing13;
if((((((((((data46.window_sessions === undefined) || (!(func0.call(data46, "window_sessions")))) && (missing13 = "window_sessions")) || (((data46.status === undefined) || (!(func0.call(data46, "status")))) && (missing13 = "status"))) || (((data46.start_session === undefined) || (!(func0.call(data46, "start_session")))) && (missing13 = "start_session"))) || (((data46.end_session === undefined) || (!(func0.call(data46, "end_session")))) && (missing13 = "end_session"))) || (((data46.benchmark_return_pct === undefined) || (!(func0.call(data46, "benchmark_return_pct")))) && (missing13 = "benchmark_return_pct"))) || (((data46.benchmark_null_reason === undefined) || (!(func0.call(data46, "benchmark_null_reason")))) && (missing13 = "benchmark_null_reason"))) || (((data46.benchmark_coverage === undefined) || (!(func0.call(data46, "benchmark_coverage")))) && (missing13 = "benchmark_coverage"))) || (((data46.null_reason === undefined) || (!(func0.call(data46, "null_reason")))) && (missing13 = "null_reason"))){
validate11.errors = [{instancePath:instancePath+"/windows/5",schemaPath:"#/properties/windows/properties/5/required",keyword:"required",params:{missingProperty: missing13},message:"must have required property '"+missing13+"'"}];
return false;
}
else {
const _errs122 = errors;
for(const key13 of Object.keys(data46)){
if(!((((((((key13 === "window_sessions") || (key13 === "status")) || (key13 === "start_session")) || (key13 === "end_session")) || (key13 === "benchmark_return_pct")) || (key13 === "benchmark_null_reason")) || (key13 === "benchmark_coverage")) || (key13 === "null_reason"))){
validate11.errors = [{instancePath:instancePath+"/windows/5",schemaPath:"#/properties/windows/properties/5/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key13},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs122 === errors){
if(data46.window_sessions !== undefined && func0.call(data46, "window_sessions")){
const _errs123 = errors;
if(5 !== data46.window_sessions){
validate11.errors = [{instancePath:instancePath+"/windows/5/window_sessions",schemaPath:"#/properties/windows/properties/5/properties/window_sessions/const",keyword:"const",params:{allowedValue: 5},message:"must be equal to constant"}];
return false;
}
var valid24 = _errs123 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data46.status !== undefined && func0.call(data46, "status")){
let data48 = data46.status;
const _errs124 = errors;
if(!(((data48 === "available") || (data48 === "partial")) || (data48 === "unavailable"))){
validate11.errors = [{instancePath:instancePath+"/windows/5/status",schemaPath:"#/properties/windows/properties/5/properties/status/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["5"].properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid24 = _errs124 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data46.start_session !== undefined && func0.call(data46, "start_session")){
let data49 = data46.start_session;
const _errs125 = errors;
const _errs126 = errors;
let valid25 = false;
const _errs127 = errors;
if(errors === _errs127){
if(errors === _errs127){
if(typeof data49 === "string"){
if(!pattern12.test(data49)){
const err73 = {instancePath:instancePath+"/windows/5/start_session",schemaPath:"#/properties/windows/properties/5/properties/start_session/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
else {
if(!(formats0.validate(data49))){
const err74 = {instancePath:instancePath+"/windows/5/start_session",schemaPath:"#/properties/windows/properties/5/properties/start_session/anyOf/0/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
}
}
else {
const err75 = {instancePath:instancePath+"/windows/5/start_session",schemaPath:"#/properties/windows/properties/5/properties/start_session/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
}
}
var _valid9 = _errs127 === errors;
valid25 = valid25 || _valid9;
if(!valid25){
const _errs129 = errors;
if(data49 !== null){
const err76 = {instancePath:instancePath+"/windows/5/start_session",schemaPath:"#/properties/windows/properties/5/properties/start_session/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
var _valid9 = _errs129 === errors;
valid25 = valid25 || _valid9;
}
if(!valid25){
const err77 = {instancePath:instancePath+"/windows/5/start_session",schemaPath:"#/properties/windows/properties/5/properties/start_session/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs126;
if(vErrors !== null){
if(_errs126){
vErrors.length = _errs126;
}
else {
vErrors = null;
}
}
}
var valid24 = _errs125 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data46.end_session !== undefined && func0.call(data46, "end_session")){
let data50 = data46.end_session;
const _errs131 = errors;
if(errors === _errs131){
if(errors === _errs131){
if(typeof data50 === "string"){
if(!pattern12.test(data50)){
validate11.errors = [{instancePath:instancePath+"/windows/5/end_session",schemaPath:"#/properties/windows/properties/5/properties/end_session/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""}];
return false;
}
else {
if(!(formats0.validate(data50))){
validate11.errors = [{instancePath:instancePath+"/windows/5/end_session",schemaPath:"#/properties/windows/properties/5/properties/end_session/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/5/end_session",schemaPath:"#/properties/windows/properties/5/properties/end_session/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
}
var valid24 = _errs131 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data46.benchmark_return_pct !== undefined && func0.call(data46, "benchmark_return_pct")){
let data51 = data46.benchmark_return_pct;
const _errs133 = errors;
const _errs134 = errors;
let valid26 = false;
const _errs135 = errors;
if(errors === _errs135){
if((typeof data51 == "number") && (isFinite(data51))){
if(data51 < -100 || isNaN(data51)){
const err78 = {instancePath:instancePath+"/windows/5/benchmark_return_pct",schemaPath:"#/properties/windows/properties/5/properties/benchmark_return_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
}
else {
const err79 = {instancePath:instancePath+"/windows/5/benchmark_return_pct",schemaPath:"#/properties/windows/properties/5/properties/benchmark_return_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
var _valid10 = _errs135 === errors;
valid26 = valid26 || _valid10;
if(!valid26){
const _errs137 = errors;
if(data51 !== null){
const err80 = {instancePath:instancePath+"/windows/5/benchmark_return_pct",schemaPath:"#/properties/windows/properties/5/properties/benchmark_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
var _valid10 = _errs137 === errors;
valid26 = valid26 || _valid10;
}
if(!valid26){
const err81 = {instancePath:instancePath+"/windows/5/benchmark_return_pct",schemaPath:"#/properties/windows/properties/5/properties/benchmark_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs134;
if(vErrors !== null){
if(_errs134){
vErrors.length = _errs134;
}
else {
vErrors = null;
}
}
}
var valid24 = _errs133 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data46.benchmark_null_reason !== undefined && func0.call(data46, "benchmark_null_reason")){
let data52 = data46.benchmark_null_reason;
const _errs139 = errors;
const _errs140 = errors;
let valid27 = false;
const _errs141 = errors;
if(!((((((((((((((data52 === "missing_input") || (data52 === "non_finite_input")) || (data52 === "invalid_price")) || (data52 === "benchmark_missing")) || (data52 === "benchmark_invalid")) || (data52 === "insufficient_reference_history")) || (data52 === "empty_panel")) || (data52 === "future_tail")) || (data52 === "source_session_mismatch")) || (data52 === "ambiguous_duplicate_price_index")) || (data52 === "ambiguous_duplicate_column")) || (data52 === "cohort_identity_mismatch")) || (data52 === "benchmark_identity_mismatch")) || (data52 === "return_basis_not_qualified"))){
const err82 = {instancePath:instancePath+"/windows/5/benchmark_null_reason",schemaPath:"#/properties/windows/properties/5/properties/benchmark_null_reason/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["5"].properties.benchmark_null_reason.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
var _valid11 = _errs141 === errors;
valid27 = valid27 || _valid11;
if(!valid27){
const _errs142 = errors;
if(data52 !== null){
const err83 = {instancePath:instancePath+"/windows/5/benchmark_null_reason",schemaPath:"#/properties/windows/properties/5/properties/benchmark_null_reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
var _valid11 = _errs142 === errors;
valid27 = valid27 || _valid11;
}
if(!valid27){
const err84 = {instancePath:instancePath+"/windows/5/benchmark_null_reason",schemaPath:"#/properties/windows/properties/5/properties/benchmark_null_reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs140;
if(vErrors !== null){
if(_errs140){
vErrors.length = _errs140;
}
else {
vErrors = null;
}
}
}
var valid24 = _errs139 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data46.benchmark_coverage !== undefined && func0.call(data46, "benchmark_coverage")){
let data53 = data46.benchmark_coverage;
const _errs144 = errors;
if(errors === _errs144){
if(data53 && typeof data53 == "object" && !Array.isArray(data53)){
let missing14;
if(((((data53.observed_n === undefined) || (!(func0.call(data53, "observed_n")))) && (missing14 = "observed_n")) || (((data53.expected_n === undefined) || (!(func0.call(data53, "expected_n")))) && (missing14 = "expected_n"))) || (((data53.ratio === undefined) || (!(func0.call(data53, "ratio")))) && (missing14 = "ratio"))){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/required",keyword:"required",params:{missingProperty: missing14},message:"must have required property '"+missing14+"'"}];
return false;
}
else {
const _errs146 = errors;
for(const key14 of Object.keys(data53)){
if(!(((key14 === "observed_n") || (key14 === "expected_n")) || (key14 === "ratio"))){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key14},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs146 === errors){
if(data53.observed_n !== undefined && func0.call(data53, "observed_n")){
let data54 = data53.observed_n;
const _errs147 = errors;
if(!(((typeof data54 == "number") && (!(data54 % 1) && !isNaN(data54))) && (isFinite(data54)))){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/observed_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs147){
if((typeof data54 == "number") && (isFinite(data54))){
if(data54 > 64 || isNaN(data54)){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/observed_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data54 < 0 || isNaN(data54)){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/observed_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid28 = _errs147 === errors;
}
else {
var valid28 = true;
}
if(valid28){
if(data53.expected_n !== undefined && func0.call(data53, "expected_n")){
let data55 = data53.expected_n;
const _errs149 = errors;
if(!(((typeof data55 == "number") && (!(data55 % 1) && !isNaN(data55))) && (isFinite(data55)))){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/expected_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs149){
if((typeof data55 == "number") && (isFinite(data55))){
if(data55 > 64 || isNaN(data55)){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/expected_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data55 < 0 || isNaN(data55)){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/expected_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid28 = _errs149 === errors;
}
else {
var valid28 = true;
}
if(valid28){
if(data53.ratio !== undefined && func0.call(data53, "ratio")){
let data56 = data53.ratio;
const _errs151 = errors;
if(errors === _errs151){
if((typeof data56 == "number") && (isFinite(data56))){
if(data56 > 1 || isNaN(data56)){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/ratio/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"}];
return false;
}
else {
if(data56 < 0 || isNaN(data56)){
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/ratio/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/properties/ratio/type",keyword:"type",params:{type: "number"},message:"must be number"}];
return false;
}
}
var valid28 = _errs151 === errors;
}
else {
var valid28 = true;
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/5/benchmark_coverage",schemaPath:"#/properties/windows/properties/5/properties/benchmark_coverage/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid24 = _errs144 === errors;
}
else {
var valid24 = true;
}
if(valid24){
if(data46.null_reason !== undefined && func0.call(data46, "null_reason")){
let data57 = data46.null_reason;
const _errs153 = errors;
const _errs154 = errors;
let valid29 = false;
const _errs155 = errors;
if(!((((((((((((((data57 === "missing_input") || (data57 === "non_finite_input")) || (data57 === "invalid_price")) || (data57 === "benchmark_missing")) || (data57 === "benchmark_invalid")) || (data57 === "insufficient_reference_history")) || (data57 === "empty_panel")) || (data57 === "future_tail")) || (data57 === "source_session_mismatch")) || (data57 === "ambiguous_duplicate_price_index")) || (data57 === "ambiguous_duplicate_column")) || (data57 === "cohort_identity_mismatch")) || (data57 === "benchmark_identity_mismatch")) || (data57 === "return_basis_not_qualified"))){
const err85 = {instancePath:instancePath+"/windows/5/null_reason",schemaPath:"#/properties/windows/properties/5/properties/null_reason/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["5"].properties.null_reason.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
var _valid12 = _errs155 === errors;
valid29 = valid29 || _valid12;
if(!valid29){
const _errs156 = errors;
if(data57 !== null){
const err86 = {instancePath:instancePath+"/windows/5/null_reason",schemaPath:"#/properties/windows/properties/5/properties/null_reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
var _valid12 = _errs156 === errors;
valid29 = valid29 || _valid12;
}
if(!valid29){
const err87 = {instancePath:instancePath+"/windows/5/null_reason",schemaPath:"#/properties/windows/properties/5/properties/null_reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs154;
if(vErrors !== null){
if(_errs154){
vErrors.length = _errs154;
}
else {
vErrors = null;
}
}
}
var valid24 = _errs153 === errors;
}
else {
var valid24 = true;
}
}
}
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/5",schemaPath:"#/properties/windows/properties/5/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid23 = _errs120 === errors;
}
else {
var valid23 = true;
}
if(valid23){
if(data45["20"] !== undefined && func0.call(data45, "20")){
let data58 = data45["20"];
const _errs158 = errors;
if(errors === _errs158){
if(data58 && typeof data58 == "object" && !Array.isArray(data58)){
let missing15;
if((((((((((data58.window_sessions === undefined) || (!(func0.call(data58, "window_sessions")))) && (missing15 = "window_sessions")) || (((data58.status === undefined) || (!(func0.call(data58, "status")))) && (missing15 = "status"))) || (((data58.start_session === undefined) || (!(func0.call(data58, "start_session")))) && (missing15 = "start_session"))) || (((data58.end_session === undefined) || (!(func0.call(data58, "end_session")))) && (missing15 = "end_session"))) || (((data58.benchmark_return_pct === undefined) || (!(func0.call(data58, "benchmark_return_pct")))) && (missing15 = "benchmark_return_pct"))) || (((data58.benchmark_null_reason === undefined) || (!(func0.call(data58, "benchmark_null_reason")))) && (missing15 = "benchmark_null_reason"))) || (((data58.benchmark_coverage === undefined) || (!(func0.call(data58, "benchmark_coverage")))) && (missing15 = "benchmark_coverage"))) || (((data58.null_reason === undefined) || (!(func0.call(data58, "null_reason")))) && (missing15 = "null_reason"))){
validate11.errors = [{instancePath:instancePath+"/windows/20",schemaPath:"#/properties/windows/properties/20/required",keyword:"required",params:{missingProperty: missing15},message:"must have required property '"+missing15+"'"}];
return false;
}
else {
const _errs160 = errors;
for(const key15 of Object.keys(data58)){
if(!((((((((key15 === "window_sessions") || (key15 === "status")) || (key15 === "start_session")) || (key15 === "end_session")) || (key15 === "benchmark_return_pct")) || (key15 === "benchmark_null_reason")) || (key15 === "benchmark_coverage")) || (key15 === "null_reason"))){
validate11.errors = [{instancePath:instancePath+"/windows/20",schemaPath:"#/properties/windows/properties/20/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key15},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs160 === errors){
if(data58.window_sessions !== undefined && func0.call(data58, "window_sessions")){
const _errs161 = errors;
if(20 !== data58.window_sessions){
validate11.errors = [{instancePath:instancePath+"/windows/20/window_sessions",schemaPath:"#/properties/windows/properties/20/properties/window_sessions/const",keyword:"const",params:{allowedValue: 20},message:"must be equal to constant"}];
return false;
}
var valid30 = _errs161 === errors;
}
else {
var valid30 = true;
}
if(valid30){
if(data58.status !== undefined && func0.call(data58, "status")){
let data60 = data58.status;
const _errs162 = errors;
if(!(((data60 === "available") || (data60 === "partial")) || (data60 === "unavailable"))){
validate11.errors = [{instancePath:instancePath+"/windows/20/status",schemaPath:"#/properties/windows/properties/20/properties/status/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["20"].properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid30 = _errs162 === errors;
}
else {
var valid30 = true;
}
if(valid30){
if(data58.start_session !== undefined && func0.call(data58, "start_session")){
let data61 = data58.start_session;
const _errs163 = errors;
const _errs164 = errors;
let valid31 = false;
const _errs165 = errors;
if(errors === _errs165){
if(errors === _errs165){
if(typeof data61 === "string"){
if(!pattern12.test(data61)){
const err88 = {instancePath:instancePath+"/windows/20/start_session",schemaPath:"#/properties/windows/properties/20/properties/start_session/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
else {
if(!(formats0.validate(data61))){
const err89 = {instancePath:instancePath+"/windows/20/start_session",schemaPath:"#/properties/windows/properties/20/properties/start_session/anyOf/0/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
}
}
else {
const err90 = {instancePath:instancePath+"/windows/20/start_session",schemaPath:"#/properties/windows/properties/20/properties/start_session/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
}
}
var _valid13 = _errs165 === errors;
valid31 = valid31 || _valid13;
if(!valid31){
const _errs167 = errors;
if(data61 !== null){
const err91 = {instancePath:instancePath+"/windows/20/start_session",schemaPath:"#/properties/windows/properties/20/properties/start_session/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
var _valid13 = _errs167 === errors;
valid31 = valid31 || _valid13;
}
if(!valid31){
const err92 = {instancePath:instancePath+"/windows/20/start_session",schemaPath:"#/properties/windows/properties/20/properties/start_session/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs164;
if(vErrors !== null){
if(_errs164){
vErrors.length = _errs164;
}
else {
vErrors = null;
}
}
}
var valid30 = _errs163 === errors;
}
else {
var valid30 = true;
}
if(valid30){
if(data58.end_session !== undefined && func0.call(data58, "end_session")){
let data62 = data58.end_session;
const _errs169 = errors;
if(errors === _errs169){
if(errors === _errs169){
if(typeof data62 === "string"){
if(!pattern12.test(data62)){
validate11.errors = [{instancePath:instancePath+"/windows/20/end_session",schemaPath:"#/properties/windows/properties/20/properties/end_session/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""}];
return false;
}
else {
if(!(formats0.validate(data62))){
validate11.errors = [{instancePath:instancePath+"/windows/20/end_session",schemaPath:"#/properties/windows/properties/20/properties/end_session/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/20/end_session",schemaPath:"#/properties/windows/properties/20/properties/end_session/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
}
var valid30 = _errs169 === errors;
}
else {
var valid30 = true;
}
if(valid30){
if(data58.benchmark_return_pct !== undefined && func0.call(data58, "benchmark_return_pct")){
let data63 = data58.benchmark_return_pct;
const _errs171 = errors;
const _errs172 = errors;
let valid32 = false;
const _errs173 = errors;
if(errors === _errs173){
if((typeof data63 == "number") && (isFinite(data63))){
if(data63 < -100 || isNaN(data63)){
const err93 = {instancePath:instancePath+"/windows/20/benchmark_return_pct",schemaPath:"#/properties/windows/properties/20/properties/benchmark_return_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
}
else {
const err94 = {instancePath:instancePath+"/windows/20/benchmark_return_pct",schemaPath:"#/properties/windows/properties/20/properties/benchmark_return_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
}
var _valid14 = _errs173 === errors;
valid32 = valid32 || _valid14;
if(!valid32){
const _errs175 = errors;
if(data63 !== null){
const err95 = {instancePath:instancePath+"/windows/20/benchmark_return_pct",schemaPath:"#/properties/windows/properties/20/properties/benchmark_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
var _valid14 = _errs175 === errors;
valid32 = valid32 || _valid14;
}
if(!valid32){
const err96 = {instancePath:instancePath+"/windows/20/benchmark_return_pct",schemaPath:"#/properties/windows/properties/20/properties/benchmark_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs172;
if(vErrors !== null){
if(_errs172){
vErrors.length = _errs172;
}
else {
vErrors = null;
}
}
}
var valid30 = _errs171 === errors;
}
else {
var valid30 = true;
}
if(valid30){
if(data58.benchmark_null_reason !== undefined && func0.call(data58, "benchmark_null_reason")){
let data64 = data58.benchmark_null_reason;
const _errs177 = errors;
const _errs178 = errors;
let valid33 = false;
const _errs179 = errors;
if(!((((((((((((((data64 === "missing_input") || (data64 === "non_finite_input")) || (data64 === "invalid_price")) || (data64 === "benchmark_missing")) || (data64 === "benchmark_invalid")) || (data64 === "insufficient_reference_history")) || (data64 === "empty_panel")) || (data64 === "future_tail")) || (data64 === "source_session_mismatch")) || (data64 === "ambiguous_duplicate_price_index")) || (data64 === "ambiguous_duplicate_column")) || (data64 === "cohort_identity_mismatch")) || (data64 === "benchmark_identity_mismatch")) || (data64 === "return_basis_not_qualified"))){
const err97 = {instancePath:instancePath+"/windows/20/benchmark_null_reason",schemaPath:"#/properties/windows/properties/20/properties/benchmark_null_reason/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["20"].properties.benchmark_null_reason.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
var _valid15 = _errs179 === errors;
valid33 = valid33 || _valid15;
if(!valid33){
const _errs180 = errors;
if(data64 !== null){
const err98 = {instancePath:instancePath+"/windows/20/benchmark_null_reason",schemaPath:"#/properties/windows/properties/20/properties/benchmark_null_reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
var _valid15 = _errs180 === errors;
valid33 = valid33 || _valid15;
}
if(!valid33){
const err99 = {instancePath:instancePath+"/windows/20/benchmark_null_reason",schemaPath:"#/properties/windows/properties/20/properties/benchmark_null_reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs178;
if(vErrors !== null){
if(_errs178){
vErrors.length = _errs178;
}
else {
vErrors = null;
}
}
}
var valid30 = _errs177 === errors;
}
else {
var valid30 = true;
}
if(valid30){
if(data58.benchmark_coverage !== undefined && func0.call(data58, "benchmark_coverage")){
let data65 = data58.benchmark_coverage;
const _errs182 = errors;
if(errors === _errs182){
if(data65 && typeof data65 == "object" && !Array.isArray(data65)){
let missing16;
if(((((data65.observed_n === undefined) || (!(func0.call(data65, "observed_n")))) && (missing16 = "observed_n")) || (((data65.expected_n === undefined) || (!(func0.call(data65, "expected_n")))) && (missing16 = "expected_n"))) || (((data65.ratio === undefined) || (!(func0.call(data65, "ratio")))) && (missing16 = "ratio"))){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/required",keyword:"required",params:{missingProperty: missing16},message:"must have required property '"+missing16+"'"}];
return false;
}
else {
const _errs184 = errors;
for(const key16 of Object.keys(data65)){
if(!(((key16 === "observed_n") || (key16 === "expected_n")) || (key16 === "ratio"))){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key16},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs184 === errors){
if(data65.observed_n !== undefined && func0.call(data65, "observed_n")){
let data66 = data65.observed_n;
const _errs185 = errors;
if(!(((typeof data66 == "number") && (!(data66 % 1) && !isNaN(data66))) && (isFinite(data66)))){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/observed_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs185){
if((typeof data66 == "number") && (isFinite(data66))){
if(data66 > 64 || isNaN(data66)){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/observed_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data66 < 0 || isNaN(data66)){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/observed_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid34 = _errs185 === errors;
}
else {
var valid34 = true;
}
if(valid34){
if(data65.expected_n !== undefined && func0.call(data65, "expected_n")){
let data67 = data65.expected_n;
const _errs187 = errors;
if(!(((typeof data67 == "number") && (!(data67 % 1) && !isNaN(data67))) && (isFinite(data67)))){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/expected_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs187){
if((typeof data67 == "number") && (isFinite(data67))){
if(data67 > 64 || isNaN(data67)){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/expected_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data67 < 0 || isNaN(data67)){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/expected_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid34 = _errs187 === errors;
}
else {
var valid34 = true;
}
if(valid34){
if(data65.ratio !== undefined && func0.call(data65, "ratio")){
let data68 = data65.ratio;
const _errs189 = errors;
if(errors === _errs189){
if((typeof data68 == "number") && (isFinite(data68))){
if(data68 > 1 || isNaN(data68)){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/ratio/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"}];
return false;
}
else {
if(data68 < 0 || isNaN(data68)){
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/ratio/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/properties/ratio/type",keyword:"type",params:{type: "number"},message:"must be number"}];
return false;
}
}
var valid34 = _errs189 === errors;
}
else {
var valid34 = true;
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/20/benchmark_coverage",schemaPath:"#/properties/windows/properties/20/properties/benchmark_coverage/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid30 = _errs182 === errors;
}
else {
var valid30 = true;
}
if(valid30){
if(data58.null_reason !== undefined && func0.call(data58, "null_reason")){
let data69 = data58.null_reason;
const _errs191 = errors;
const _errs192 = errors;
let valid35 = false;
const _errs193 = errors;
if(!((((((((((((((data69 === "missing_input") || (data69 === "non_finite_input")) || (data69 === "invalid_price")) || (data69 === "benchmark_missing")) || (data69 === "benchmark_invalid")) || (data69 === "insufficient_reference_history")) || (data69 === "empty_panel")) || (data69 === "future_tail")) || (data69 === "source_session_mismatch")) || (data69 === "ambiguous_duplicate_price_index")) || (data69 === "ambiguous_duplicate_column")) || (data69 === "cohort_identity_mismatch")) || (data69 === "benchmark_identity_mismatch")) || (data69 === "return_basis_not_qualified"))){
const err100 = {instancePath:instancePath+"/windows/20/null_reason",schemaPath:"#/properties/windows/properties/20/properties/null_reason/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["20"].properties.null_reason.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
var _valid16 = _errs193 === errors;
valid35 = valid35 || _valid16;
if(!valid35){
const _errs194 = errors;
if(data69 !== null){
const err101 = {instancePath:instancePath+"/windows/20/null_reason",schemaPath:"#/properties/windows/properties/20/properties/null_reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
var _valid16 = _errs194 === errors;
valid35 = valid35 || _valid16;
}
if(!valid35){
const err102 = {instancePath:instancePath+"/windows/20/null_reason",schemaPath:"#/properties/windows/properties/20/properties/null_reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs192;
if(vErrors !== null){
if(_errs192){
vErrors.length = _errs192;
}
else {
vErrors = null;
}
}
}
var valid30 = _errs191 === errors;
}
else {
var valid30 = true;
}
}
}
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/20",schemaPath:"#/properties/windows/properties/20/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid23 = _errs158 === errors;
}
else {
var valid23 = true;
}
if(valid23){
if(data45["63"] !== undefined && func0.call(data45, "63")){
let data70 = data45["63"];
const _errs196 = errors;
if(errors === _errs196){
if(data70 && typeof data70 == "object" && !Array.isArray(data70)){
let missing17;
if((((((((((data70.window_sessions === undefined) || (!(func0.call(data70, "window_sessions")))) && (missing17 = "window_sessions")) || (((data70.status === undefined) || (!(func0.call(data70, "status")))) && (missing17 = "status"))) || (((data70.start_session === undefined) || (!(func0.call(data70, "start_session")))) && (missing17 = "start_session"))) || (((data70.end_session === undefined) || (!(func0.call(data70, "end_session")))) && (missing17 = "end_session"))) || (((data70.benchmark_return_pct === undefined) || (!(func0.call(data70, "benchmark_return_pct")))) && (missing17 = "benchmark_return_pct"))) || (((data70.benchmark_null_reason === undefined) || (!(func0.call(data70, "benchmark_null_reason")))) && (missing17 = "benchmark_null_reason"))) || (((data70.benchmark_coverage === undefined) || (!(func0.call(data70, "benchmark_coverage")))) && (missing17 = "benchmark_coverage"))) || (((data70.null_reason === undefined) || (!(func0.call(data70, "null_reason")))) && (missing17 = "null_reason"))){
validate11.errors = [{instancePath:instancePath+"/windows/63",schemaPath:"#/properties/windows/properties/63/required",keyword:"required",params:{missingProperty: missing17},message:"must have required property '"+missing17+"'"}];
return false;
}
else {
const _errs198 = errors;
for(const key17 of Object.keys(data70)){
if(!((((((((key17 === "window_sessions") || (key17 === "status")) || (key17 === "start_session")) || (key17 === "end_session")) || (key17 === "benchmark_return_pct")) || (key17 === "benchmark_null_reason")) || (key17 === "benchmark_coverage")) || (key17 === "null_reason"))){
validate11.errors = [{instancePath:instancePath+"/windows/63",schemaPath:"#/properties/windows/properties/63/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key17},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs198 === errors){
if(data70.window_sessions !== undefined && func0.call(data70, "window_sessions")){
const _errs199 = errors;
if(63 !== data70.window_sessions){
validate11.errors = [{instancePath:instancePath+"/windows/63/window_sessions",schemaPath:"#/properties/windows/properties/63/properties/window_sessions/const",keyword:"const",params:{allowedValue: 63},message:"must be equal to constant"}];
return false;
}
var valid36 = _errs199 === errors;
}
else {
var valid36 = true;
}
if(valid36){
if(data70.status !== undefined && func0.call(data70, "status")){
let data72 = data70.status;
const _errs200 = errors;
if(!(((data72 === "available") || (data72 === "partial")) || (data72 === "unavailable"))){
validate11.errors = [{instancePath:instancePath+"/windows/63/status",schemaPath:"#/properties/windows/properties/63/properties/status/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["63"].properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid36 = _errs200 === errors;
}
else {
var valid36 = true;
}
if(valid36){
if(data70.start_session !== undefined && func0.call(data70, "start_session")){
let data73 = data70.start_session;
const _errs201 = errors;
const _errs202 = errors;
let valid37 = false;
const _errs203 = errors;
if(errors === _errs203){
if(errors === _errs203){
if(typeof data73 === "string"){
if(!pattern12.test(data73)){
const err103 = {instancePath:instancePath+"/windows/63/start_session",schemaPath:"#/properties/windows/properties/63/properties/start_session/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
else {
if(!(formats0.validate(data73))){
const err104 = {instancePath:instancePath+"/windows/63/start_session",schemaPath:"#/properties/windows/properties/63/properties/start_session/anyOf/0/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
}
}
else {
const err105 = {instancePath:instancePath+"/windows/63/start_session",schemaPath:"#/properties/windows/properties/63/properties/start_session/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
}
}
var _valid17 = _errs203 === errors;
valid37 = valid37 || _valid17;
if(!valid37){
const _errs205 = errors;
if(data73 !== null){
const err106 = {instancePath:instancePath+"/windows/63/start_session",schemaPath:"#/properties/windows/properties/63/properties/start_session/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
var _valid17 = _errs205 === errors;
valid37 = valid37 || _valid17;
}
if(!valid37){
const err107 = {instancePath:instancePath+"/windows/63/start_session",schemaPath:"#/properties/windows/properties/63/properties/start_session/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs202;
if(vErrors !== null){
if(_errs202){
vErrors.length = _errs202;
}
else {
vErrors = null;
}
}
}
var valid36 = _errs201 === errors;
}
else {
var valid36 = true;
}
if(valid36){
if(data70.end_session !== undefined && func0.call(data70, "end_session")){
let data74 = data70.end_session;
const _errs207 = errors;
if(errors === _errs207){
if(errors === _errs207){
if(typeof data74 === "string"){
if(!pattern12.test(data74)){
validate11.errors = [{instancePath:instancePath+"/windows/63/end_session",schemaPath:"#/properties/windows/properties/63/properties/end_session/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""}];
return false;
}
else {
if(!(formats0.validate(data74))){
validate11.errors = [{instancePath:instancePath+"/windows/63/end_session",schemaPath:"#/properties/windows/properties/63/properties/end_session/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/63/end_session",schemaPath:"#/properties/windows/properties/63/properties/end_session/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
}
var valid36 = _errs207 === errors;
}
else {
var valid36 = true;
}
if(valid36){
if(data70.benchmark_return_pct !== undefined && func0.call(data70, "benchmark_return_pct")){
let data75 = data70.benchmark_return_pct;
const _errs209 = errors;
const _errs210 = errors;
let valid38 = false;
const _errs211 = errors;
if(errors === _errs211){
if((typeof data75 == "number") && (isFinite(data75))){
if(data75 < -100 || isNaN(data75)){
const err108 = {instancePath:instancePath+"/windows/63/benchmark_return_pct",schemaPath:"#/properties/windows/properties/63/properties/benchmark_return_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
}
else {
const err109 = {instancePath:instancePath+"/windows/63/benchmark_return_pct",schemaPath:"#/properties/windows/properties/63/properties/benchmark_return_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
}
var _valid18 = _errs211 === errors;
valid38 = valid38 || _valid18;
if(!valid38){
const _errs213 = errors;
if(data75 !== null){
const err110 = {instancePath:instancePath+"/windows/63/benchmark_return_pct",schemaPath:"#/properties/windows/properties/63/properties/benchmark_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
var _valid18 = _errs213 === errors;
valid38 = valid38 || _valid18;
}
if(!valid38){
const err111 = {instancePath:instancePath+"/windows/63/benchmark_return_pct",schemaPath:"#/properties/windows/properties/63/properties/benchmark_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs210;
if(vErrors !== null){
if(_errs210){
vErrors.length = _errs210;
}
else {
vErrors = null;
}
}
}
var valid36 = _errs209 === errors;
}
else {
var valid36 = true;
}
if(valid36){
if(data70.benchmark_null_reason !== undefined && func0.call(data70, "benchmark_null_reason")){
let data76 = data70.benchmark_null_reason;
const _errs215 = errors;
const _errs216 = errors;
let valid39 = false;
const _errs217 = errors;
if(!((((((((((((((data76 === "missing_input") || (data76 === "non_finite_input")) || (data76 === "invalid_price")) || (data76 === "benchmark_missing")) || (data76 === "benchmark_invalid")) || (data76 === "insufficient_reference_history")) || (data76 === "empty_panel")) || (data76 === "future_tail")) || (data76 === "source_session_mismatch")) || (data76 === "ambiguous_duplicate_price_index")) || (data76 === "ambiguous_duplicate_column")) || (data76 === "cohort_identity_mismatch")) || (data76 === "benchmark_identity_mismatch")) || (data76 === "return_basis_not_qualified"))){
const err112 = {instancePath:instancePath+"/windows/63/benchmark_null_reason",schemaPath:"#/properties/windows/properties/63/properties/benchmark_null_reason/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["63"].properties.benchmark_null_reason.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err112];
}
else {
vErrors.push(err112);
}
errors++;
}
var _valid19 = _errs217 === errors;
valid39 = valid39 || _valid19;
if(!valid39){
const _errs218 = errors;
if(data76 !== null){
const err113 = {instancePath:instancePath+"/windows/63/benchmark_null_reason",schemaPath:"#/properties/windows/properties/63/properties/benchmark_null_reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err113];
}
else {
vErrors.push(err113);
}
errors++;
}
var _valid19 = _errs218 === errors;
valid39 = valid39 || _valid19;
}
if(!valid39){
const err114 = {instancePath:instancePath+"/windows/63/benchmark_null_reason",schemaPath:"#/properties/windows/properties/63/properties/benchmark_null_reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err114];
}
else {
vErrors.push(err114);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs216;
if(vErrors !== null){
if(_errs216){
vErrors.length = _errs216;
}
else {
vErrors = null;
}
}
}
var valid36 = _errs215 === errors;
}
else {
var valid36 = true;
}
if(valid36){
if(data70.benchmark_coverage !== undefined && func0.call(data70, "benchmark_coverage")){
let data77 = data70.benchmark_coverage;
const _errs220 = errors;
if(errors === _errs220){
if(data77 && typeof data77 == "object" && !Array.isArray(data77)){
let missing18;
if(((((data77.observed_n === undefined) || (!(func0.call(data77, "observed_n")))) && (missing18 = "observed_n")) || (((data77.expected_n === undefined) || (!(func0.call(data77, "expected_n")))) && (missing18 = "expected_n"))) || (((data77.ratio === undefined) || (!(func0.call(data77, "ratio")))) && (missing18 = "ratio"))){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/required",keyword:"required",params:{missingProperty: missing18},message:"must have required property '"+missing18+"'"}];
return false;
}
else {
const _errs222 = errors;
for(const key18 of Object.keys(data77)){
if(!(((key18 === "observed_n") || (key18 === "expected_n")) || (key18 === "ratio"))){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key18},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs222 === errors){
if(data77.observed_n !== undefined && func0.call(data77, "observed_n")){
let data78 = data77.observed_n;
const _errs223 = errors;
if(!(((typeof data78 == "number") && (!(data78 % 1) && !isNaN(data78))) && (isFinite(data78)))){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/observed_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs223){
if((typeof data78 == "number") && (isFinite(data78))){
if(data78 > 64 || isNaN(data78)){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/observed_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data78 < 0 || isNaN(data78)){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/observed_n",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/observed_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid40 = _errs223 === errors;
}
else {
var valid40 = true;
}
if(valid40){
if(data77.expected_n !== undefined && func0.call(data77, "expected_n")){
let data79 = data77.expected_n;
const _errs225 = errors;
if(!(((typeof data79 == "number") && (!(data79 % 1) && !isNaN(data79))) && (isFinite(data79)))){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/expected_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs225){
if((typeof data79 == "number") && (isFinite(data79))){
if(data79 > 64 || isNaN(data79)){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/expected_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data79 < 0 || isNaN(data79)){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/expected_n",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/expected_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid40 = _errs225 === errors;
}
else {
var valid40 = true;
}
if(valid40){
if(data77.ratio !== undefined && func0.call(data77, "ratio")){
let data80 = data77.ratio;
const _errs227 = errors;
if(errors === _errs227){
if((typeof data80 == "number") && (isFinite(data80))){
if(data80 > 1 || isNaN(data80)){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/ratio/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"}];
return false;
}
else {
if(data80 < 0 || isNaN(data80)){
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/ratio/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage/ratio",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/properties/ratio/type",keyword:"type",params:{type: "number"},message:"must be number"}];
return false;
}
}
var valid40 = _errs227 === errors;
}
else {
var valid40 = true;
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/63/benchmark_coverage",schemaPath:"#/properties/windows/properties/63/properties/benchmark_coverage/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid36 = _errs220 === errors;
}
else {
var valid36 = true;
}
if(valid36){
if(data70.null_reason !== undefined && func0.call(data70, "null_reason")){
let data81 = data70.null_reason;
const _errs229 = errors;
const _errs230 = errors;
let valid41 = false;
const _errs231 = errors;
if(!((((((((((((((data81 === "missing_input") || (data81 === "non_finite_input")) || (data81 === "invalid_price")) || (data81 === "benchmark_missing")) || (data81 === "benchmark_invalid")) || (data81 === "insufficient_reference_history")) || (data81 === "empty_panel")) || (data81 === "future_tail")) || (data81 === "source_session_mismatch")) || (data81 === "ambiguous_duplicate_price_index")) || (data81 === "ambiguous_duplicate_column")) || (data81 === "cohort_identity_mismatch")) || (data81 === "benchmark_identity_mismatch")) || (data81 === "return_basis_not_qualified"))){
const err115 = {instancePath:instancePath+"/windows/63/null_reason",schemaPath:"#/properties/windows/properties/63/properties/null_reason/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.windows.properties["63"].properties.null_reason.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err115];
}
else {
vErrors.push(err115);
}
errors++;
}
var _valid20 = _errs231 === errors;
valid41 = valid41 || _valid20;
if(!valid41){
const _errs232 = errors;
if(data81 !== null){
const err116 = {instancePath:instancePath+"/windows/63/null_reason",schemaPath:"#/properties/windows/properties/63/properties/null_reason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err116];
}
else {
vErrors.push(err116);
}
errors++;
}
var _valid20 = _errs232 === errors;
valid41 = valid41 || _valid20;
}
if(!valid41){
const err117 = {instancePath:instancePath+"/windows/63/null_reason",schemaPath:"#/properties/windows/properties/63/properties/null_reason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err117];
}
else {
vErrors.push(err117);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs230;
if(vErrors !== null){
if(_errs230){
vErrors.length = _errs230;
}
else {
vErrors = null;
}
}
}
var valid36 = _errs229 === errors;
}
else {
var valid36 = true;
}
}
}
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows/63",schemaPath:"#/properties/windows/properties/63/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid23 = _errs196 === errors;
}
else {
var valid23 = true;
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/windows",schemaPath:"#/properties/windows/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs117 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.groups !== undefined && func0.call(data, "groups")){
let data82 = data.groups;
const _errs234 = errors;
if(errors === _errs234){
if(Array.isArray(data82)){
if(data82.length > 11){
validate11.errors = [{instancePath:instancePath+"/groups",schemaPath:"#/properties/groups/maxItems",keyword:"maxItems",params:{limit: 11},message:"must NOT have more than 11 items"}];
return false;
}
else {
if(data82.length < 11){
validate11.errors = [{instancePath:instancePath+"/groups",schemaPath:"#/properties/groups/minItems",keyword:"minItems",params:{limit: 11},message:"must NOT have fewer than 11 items"}];
return false;
}
else {
var valid42 = true;
const len1 = data82.length;
for(let i1=0; i1<len1; i1++){
let data83 = data82[i1];
const _errs236 = errors;
if(errors === _errs236){
if(data83 && typeof data83 == "object" && !Array.isArray(data83)){
let missing19;
if((((((data83.group_id === undefined) || (!(func0.call(data83, "group_id")))) && (missing19 = "group_id")) || (((data83.name_en === undefined) || (!(func0.call(data83, "name_en")))) && (missing19 = "name_en"))) || (((data83.name_zh === undefined) || (!(func0.call(data83, "name_zh")))) && (missing19 = "name_zh"))) || (((data83.windows === undefined) || (!(func0.call(data83, "windows")))) && (missing19 = "windows"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1,schemaPath:"#/properties/groups/items/required",keyword:"required",params:{missingProperty: missing19},message:"must have required property '"+missing19+"'"}];
return false;
}
else {
const _errs238 = errors;
for(const key19 of Object.keys(data83)){
if(!((((key19 === "group_id") || (key19 === "name_en")) || (key19 === "name_zh")) || (key19 === "windows"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1,schemaPath:"#/properties/groups/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key19},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs238 === errors){
if(data83.group_id !== undefined && func0.call(data83, "group_id")){
let data84 = data83.group_id;
const _errs239 = errors;
if(!(((((((((((data84 === "XLB") || (data84 === "XLC")) || (data84 === "XLE")) || (data84 === "XLF")) || (data84 === "XLI")) || (data84 === "XLK")) || (data84 === "XLP")) || (data84 === "XLRE")) || (data84 === "XLU")) || (data84 === "XLV")) || (data84 === "XLY"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/group_id",schemaPath:"#/properties/groups/items/properties/group_id/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.group_id.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid43 = _errs239 === errors;
}
else {
var valid43 = true;
}
if(valid43){
if(data83.name_en !== undefined && func0.call(data83, "name_en")){
let data85 = data83.name_en;
const _errs240 = errors;
const _errs241 = errors;
let valid44 = false;
const _errs242 = errors;
if(errors === _errs242){
if(typeof data85 === "string"){
if(func97(data85) > 120){
const err118 = {instancePath:instancePath+"/groups/" + i1+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err118];
}
else {
vErrors.push(err118);
}
errors++;
}
else {
if(func97(data85) < 1){
const err119 = {instancePath:instancePath+"/groups/" + i1+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err119];
}
else {
vErrors.push(err119);
}
errors++;
}
else {
if(!pattern2.test(data85)){
const err120 = {instancePath:instancePath+"/groups/" + i1+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err120];
}
else {
vErrors.push(err120);
}
errors++;
}
}
}
}
else {
const err121 = {instancePath:instancePath+"/groups/" + i1+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err121];
}
else {
vErrors.push(err121);
}
errors++;
}
}
var _valid21 = _errs242 === errors;
valid44 = valid44 || _valid21;
if(!valid44){
const _errs244 = errors;
if(data85 !== null){
const err122 = {instancePath:instancePath+"/groups/" + i1+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err122];
}
else {
vErrors.push(err122);
}
errors++;
}
var _valid21 = _errs244 === errors;
valid44 = valid44 || _valid21;
}
if(!valid44){
const err123 = {instancePath:instancePath+"/groups/" + i1+"/name_en",schemaPath:"#/properties/groups/items/properties/name_en/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err123];
}
else {
vErrors.push(err123);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs241;
if(vErrors !== null){
if(_errs241){
vErrors.length = _errs241;
}
else {
vErrors = null;
}
}
}
var valid43 = _errs240 === errors;
}
else {
var valid43 = true;
}
if(valid43){
if(data83.name_zh !== undefined && func0.call(data83, "name_zh")){
let data86 = data83.name_zh;
const _errs246 = errors;
const _errs247 = errors;
let valid45 = false;
const _errs248 = errors;
if(errors === _errs248){
if(typeof data86 === "string"){
if(func97(data86) > 120){
const err124 = {instancePath:instancePath+"/groups/" + i1+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/0/maxLength",keyword:"maxLength",params:{limit: 120},message:"must NOT have more than 120 characters"};
if(vErrors === null){
vErrors = [err124];
}
else {
vErrors.push(err124);
}
errors++;
}
else {
if(func97(data86) < 1){
const err125 = {instancePath:instancePath+"/groups/" + i1+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err125];
}
else {
vErrors.push(err125);
}
errors++;
}
else {
if(!pattern2.test(data86)){
const err126 = {instancePath:instancePath+"/groups/" + i1+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/0/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""};
if(vErrors === null){
vErrors = [err126];
}
else {
vErrors.push(err126);
}
errors++;
}
}
}
}
else {
const err127 = {instancePath:instancePath+"/groups/" + i1+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err127];
}
else {
vErrors.push(err127);
}
errors++;
}
}
var _valid22 = _errs248 === errors;
valid45 = valid45 || _valid22;
if(!valid45){
const _errs250 = errors;
if(data86 !== null){
const err128 = {instancePath:instancePath+"/groups/" + i1+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err128];
}
else {
vErrors.push(err128);
}
errors++;
}
var _valid22 = _errs250 === errors;
valid45 = valid45 || _valid22;
}
if(!valid45){
const err129 = {instancePath:instancePath+"/groups/" + i1+"/name_zh",schemaPath:"#/properties/groups/items/properties/name_zh/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err129];
}
else {
vErrors.push(err129);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs247;
if(vErrors !== null){
if(_errs247){
vErrors.length = _errs247;
}
else {
vErrors = null;
}
}
}
var valid43 = _errs246 === errors;
}
else {
var valid43 = true;
}
if(valid43){
if(data83.windows !== undefined && func0.call(data83, "windows")){
let data87 = data83.windows;
const _errs252 = errors;
if(errors === _errs252){
if(data87 && typeof data87 == "object" && !Array.isArray(data87)){
let missing20;
if(((((data87["5"] === undefined) || (!(func0.call(data87, "5")))) && (missing20 = "5")) || (((data87["20"] === undefined) || (!(func0.call(data87, "20")))) && (missing20 = "20"))) || (((data87["63"] === undefined) || (!(func0.call(data87, "63")))) && (missing20 = "63"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows",schemaPath:"#/properties/groups/items/properties/windows/required",keyword:"required",params:{missingProperty: missing20},message:"must have required property '"+missing20+"'"}];
return false;
}
else {
const _errs254 = errors;
for(const key20 of Object.keys(data87)){
if(!(((key20 === "5") || (key20 === "20")) || (key20 === "63"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows",schemaPath:"#/properties/groups/items/properties/windows/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key20},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs254 === errors){
if(data87["5"] !== undefined && func0.call(data87, "5")){
let data88 = data87["5"];
const _errs255 = errors;
if(errors === _errs255){
if(data88 && typeof data88 == "object" && !Array.isArray(data88)){
let missing21;
if(((((((data88.status === undefined) || (!(func0.call(data88, "status")))) && (missing21 = "status")) || (((data88.absolute_return_pct === undefined) || (!(func0.call(data88, "absolute_return_pct")))) && (missing21 = "absolute_return_pct"))) || (((data88.relative_wealth_pct === undefined) || (!(func0.call(data88, "relative_wealth_pct")))) && (missing21 = "relative_wealth_pct"))) || (((data88.null_reasons === undefined) || (!(func0.call(data88, "null_reasons")))) && (missing21 = "null_reasons"))) || (((data88.coverage === undefined) || (!(func0.call(data88, "coverage")))) && (missing21 = "coverage"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5",schemaPath:"#/properties/groups/items/properties/windows/properties/5/required",keyword:"required",params:{missingProperty: missing21},message:"must have required property '"+missing21+"'"}];
return false;
}
else {
const _errs257 = errors;
for(const key21 of Object.keys(data88)){
if(!(((((key21 === "status") || (key21 === "absolute_return_pct")) || (key21 === "relative_wealth_pct")) || (key21 === "null_reasons")) || (key21 === "coverage"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5",schemaPath:"#/properties/groups/items/properties/windows/properties/5/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key21},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs257 === errors){
if(data88.status !== undefined && func0.call(data88, "status")){
let data89 = data88.status;
const _errs258 = errors;
if(!(((data89 === "available") || (data89 === "partial")) || (data89 === "unavailable"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/status",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/status/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["5"].properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid47 = _errs258 === errors;
}
else {
var valid47 = true;
}
if(valid47){
if(data88.absolute_return_pct !== undefined && func0.call(data88, "absolute_return_pct")){
let data90 = data88.absolute_return_pct;
const _errs259 = errors;
const _errs260 = errors;
let valid48 = false;
const _errs261 = errors;
if(errors === _errs261){
if((typeof data90 == "number") && (isFinite(data90))){
if(data90 < -100 || isNaN(data90)){
const err130 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/absolute_return_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err130];
}
else {
vErrors.push(err130);
}
errors++;
}
}
else {
const err131 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/absolute_return_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err131];
}
else {
vErrors.push(err131);
}
errors++;
}
}
var _valid23 = _errs261 === errors;
valid48 = valid48 || _valid23;
if(!valid48){
const _errs263 = errors;
if(data90 !== null){
const err132 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/absolute_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err132];
}
else {
vErrors.push(err132);
}
errors++;
}
var _valid23 = _errs263 === errors;
valid48 = valid48 || _valid23;
}
if(!valid48){
const err133 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/absolute_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err133];
}
else {
vErrors.push(err133);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs260;
if(vErrors !== null){
if(_errs260){
vErrors.length = _errs260;
}
else {
vErrors = null;
}
}
}
var valid47 = _errs259 === errors;
}
else {
var valid47 = true;
}
if(valid47){
if(data88.relative_wealth_pct !== undefined && func0.call(data88, "relative_wealth_pct")){
let data91 = data88.relative_wealth_pct;
const _errs265 = errors;
const _errs266 = errors;
let valid49 = false;
const _errs267 = errors;
if(errors === _errs267){
if((typeof data91 == "number") && (isFinite(data91))){
if(data91 < -100 || isNaN(data91)){
const err134 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/relative_wealth_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err134];
}
else {
vErrors.push(err134);
}
errors++;
}
}
else {
const err135 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/relative_wealth_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err135];
}
else {
vErrors.push(err135);
}
errors++;
}
}
var _valid24 = _errs267 === errors;
valid49 = valid49 || _valid24;
if(!valid49){
const _errs269 = errors;
if(data91 !== null){
const err136 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/relative_wealth_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err136];
}
else {
vErrors.push(err136);
}
errors++;
}
var _valid24 = _errs269 === errors;
valid49 = valid49 || _valid24;
}
if(!valid49){
const err137 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/relative_wealth_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err137];
}
else {
vErrors.push(err137);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs266;
if(vErrors !== null){
if(_errs266){
vErrors.length = _errs266;
}
else {
vErrors = null;
}
}
}
var valid47 = _errs265 === errors;
}
else {
var valid47 = true;
}
if(valid47){
if(data88.null_reasons !== undefined && func0.call(data88, "null_reasons")){
let data92 = data88.null_reasons;
const _errs271 = errors;
if(errors === _errs271){
if(data92 && typeof data92 == "object" && !Array.isArray(data92)){
let missing22;
if((((data92.absolute_return_pct === undefined) || (!(func0.call(data92, "absolute_return_pct")))) && (missing22 = "absolute_return_pct")) || (((data92.relative_wealth_pct === undefined) || (!(func0.call(data92, "relative_wealth_pct")))) && (missing22 = "relative_wealth_pct"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/required",keyword:"required",params:{missingProperty: missing22},message:"must have required property '"+missing22+"'"}];
return false;
}
else {
const _errs273 = errors;
for(const key22 of Object.keys(data92)){
if(!((key22 === "absolute_return_pct") || (key22 === "relative_wealth_pct"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key22},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs273 === errors){
if(data92.absolute_return_pct !== undefined && func0.call(data92, "absolute_return_pct")){
let data93 = data92.absolute_return_pct;
const _errs274 = errors;
const _errs275 = errors;
let valid51 = false;
const _errs276 = errors;
if(!((((((((((((((data93 === "missing_input") || (data93 === "non_finite_input")) || (data93 === "invalid_price")) || (data93 === "benchmark_missing")) || (data93 === "benchmark_invalid")) || (data93 === "insufficient_reference_history")) || (data93 === "empty_panel")) || (data93 === "future_tail")) || (data93 === "source_session_mismatch")) || (data93 === "ambiguous_duplicate_price_index")) || (data93 === "ambiguous_duplicate_column")) || (data93 === "cohort_identity_mismatch")) || (data93 === "benchmark_identity_mismatch")) || (data93 === "return_basis_not_qualified"))){
const err138 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/properties/absolute_return_pct/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["5"].properties.null_reasons.properties.absolute_return_pct.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err138];
}
else {
vErrors.push(err138);
}
errors++;
}
var _valid25 = _errs276 === errors;
valid51 = valid51 || _valid25;
if(!valid51){
const _errs277 = errors;
if(data93 !== null){
const err139 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/properties/absolute_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err139];
}
else {
vErrors.push(err139);
}
errors++;
}
var _valid25 = _errs277 === errors;
valid51 = valid51 || _valid25;
}
if(!valid51){
const err140 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/properties/absolute_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err140];
}
else {
vErrors.push(err140);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs275;
if(vErrors !== null){
if(_errs275){
vErrors.length = _errs275;
}
else {
vErrors = null;
}
}
}
var valid50 = _errs274 === errors;
}
else {
var valid50 = true;
}
if(valid50){
if(data92.relative_wealth_pct !== undefined && func0.call(data92, "relative_wealth_pct")){
let data94 = data92.relative_wealth_pct;
const _errs279 = errors;
const _errs280 = errors;
let valid52 = false;
const _errs281 = errors;
if(!((((((((((((((data94 === "missing_input") || (data94 === "non_finite_input")) || (data94 === "invalid_price")) || (data94 === "benchmark_missing")) || (data94 === "benchmark_invalid")) || (data94 === "insufficient_reference_history")) || (data94 === "empty_panel")) || (data94 === "future_tail")) || (data94 === "source_session_mismatch")) || (data94 === "ambiguous_duplicate_price_index")) || (data94 === "ambiguous_duplicate_column")) || (data94 === "cohort_identity_mismatch")) || (data94 === "benchmark_identity_mismatch")) || (data94 === "return_basis_not_qualified"))){
const err141 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/properties/relative_wealth_pct/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["5"].properties.null_reasons.properties.relative_wealth_pct.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err141];
}
else {
vErrors.push(err141);
}
errors++;
}
var _valid26 = _errs281 === errors;
valid52 = valid52 || _valid26;
if(!valid52){
const _errs282 = errors;
if(data94 !== null){
const err142 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/properties/relative_wealth_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err142];
}
else {
vErrors.push(err142);
}
errors++;
}
var _valid26 = _errs282 === errors;
valid52 = valid52 || _valid26;
}
if(!valid52){
const err143 = {instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/properties/relative_wealth_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err143];
}
else {
vErrors.push(err143);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs280;
if(vErrors !== null){
if(_errs280){
vErrors.length = _errs280;
}
else {
vErrors = null;
}
}
}
var valid50 = _errs279 === errors;
}
else {
var valid50 = true;
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/null_reasons/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid47 = _errs271 === errors;
}
else {
var valid47 = true;
}
if(valid47){
if(data88.coverage !== undefined && func0.call(data88, "coverage")){
let data95 = data88.coverage;
const _errs284 = errors;
if(errors === _errs284){
if(data95 && typeof data95 == "object" && !Array.isArray(data95)){
let missing23;
if(((((data95.observed_n === undefined) || (!(func0.call(data95, "observed_n")))) && (missing23 = "observed_n")) || (((data95.expected_n === undefined) || (!(func0.call(data95, "expected_n")))) && (missing23 = "expected_n"))) || (((data95.ratio === undefined) || (!(func0.call(data95, "ratio")))) && (missing23 = "ratio"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/required",keyword:"required",params:{missingProperty: missing23},message:"must have required property '"+missing23+"'"}];
return false;
}
else {
const _errs286 = errors;
for(const key23 of Object.keys(data95)){
if(!(((key23 === "observed_n") || (key23 === "expected_n")) || (key23 === "ratio"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key23},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs286 === errors){
if(data95.observed_n !== undefined && func0.call(data95, "observed_n")){
let data96 = data95.observed_n;
const _errs287 = errors;
if(!(((typeof data96 == "number") && (!(data96 % 1) && !isNaN(data96))) && (isFinite(data96)))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/observed_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs287){
if((typeof data96 == "number") && (isFinite(data96))){
if(data96 > 64 || isNaN(data96)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/observed_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data96 < 0 || isNaN(data96)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/observed_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid53 = _errs287 === errors;
}
else {
var valid53 = true;
}
if(valid53){
if(data95.expected_n !== undefined && func0.call(data95, "expected_n")){
let data97 = data95.expected_n;
const _errs289 = errors;
if(!(((typeof data97 == "number") && (!(data97 % 1) && !isNaN(data97))) && (isFinite(data97)))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/expected_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs289){
if((typeof data97 == "number") && (isFinite(data97))){
if(data97 > 64 || isNaN(data97)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/expected_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data97 < 0 || isNaN(data97)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/expected_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid53 = _errs289 === errors;
}
else {
var valid53 = true;
}
if(valid53){
if(data95.ratio !== undefined && func0.call(data95, "ratio")){
let data98 = data95.ratio;
const _errs291 = errors;
if(errors === _errs291){
if((typeof data98 == "number") && (isFinite(data98))){
if(data98 > 1 || isNaN(data98)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/ratio/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"}];
return false;
}
else {
if(data98 < 0 || isNaN(data98)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/ratio/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/properties/ratio/type",keyword:"type",params:{type: "number"},message:"must be number"}];
return false;
}
}
var valid53 = _errs291 === errors;
}
else {
var valid53 = true;
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/5/properties/coverage/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid47 = _errs284 === errors;
}
else {
var valid47 = true;
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/5",schemaPath:"#/properties/groups/items/properties/windows/properties/5/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid46 = _errs255 === errors;
}
else {
var valid46 = true;
}
if(valid46){
if(data87["20"] !== undefined && func0.call(data87, "20")){
let data99 = data87["20"];
const _errs293 = errors;
if(errors === _errs293){
if(data99 && typeof data99 == "object" && !Array.isArray(data99)){
let missing24;
if(((((((data99.status === undefined) || (!(func0.call(data99, "status")))) && (missing24 = "status")) || (((data99.absolute_return_pct === undefined) || (!(func0.call(data99, "absolute_return_pct")))) && (missing24 = "absolute_return_pct"))) || (((data99.relative_wealth_pct === undefined) || (!(func0.call(data99, "relative_wealth_pct")))) && (missing24 = "relative_wealth_pct"))) || (((data99.null_reasons === undefined) || (!(func0.call(data99, "null_reasons")))) && (missing24 = "null_reasons"))) || (((data99.coverage === undefined) || (!(func0.call(data99, "coverage")))) && (missing24 = "coverage"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20",schemaPath:"#/properties/groups/items/properties/windows/properties/20/required",keyword:"required",params:{missingProperty: missing24},message:"must have required property '"+missing24+"'"}];
return false;
}
else {
const _errs295 = errors;
for(const key24 of Object.keys(data99)){
if(!(((((key24 === "status") || (key24 === "absolute_return_pct")) || (key24 === "relative_wealth_pct")) || (key24 === "null_reasons")) || (key24 === "coverage"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20",schemaPath:"#/properties/groups/items/properties/windows/properties/20/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key24},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs295 === errors){
if(data99.status !== undefined && func0.call(data99, "status")){
let data100 = data99.status;
const _errs296 = errors;
if(!(((data100 === "available") || (data100 === "partial")) || (data100 === "unavailable"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/status",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/status/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["20"].properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid54 = _errs296 === errors;
}
else {
var valid54 = true;
}
if(valid54){
if(data99.absolute_return_pct !== undefined && func0.call(data99, "absolute_return_pct")){
let data101 = data99.absolute_return_pct;
const _errs297 = errors;
const _errs298 = errors;
let valid55 = false;
const _errs299 = errors;
if(errors === _errs299){
if((typeof data101 == "number") && (isFinite(data101))){
if(data101 < -100 || isNaN(data101)){
const err144 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/absolute_return_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err144];
}
else {
vErrors.push(err144);
}
errors++;
}
}
else {
const err145 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/absolute_return_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err145];
}
else {
vErrors.push(err145);
}
errors++;
}
}
var _valid27 = _errs299 === errors;
valid55 = valid55 || _valid27;
if(!valid55){
const _errs301 = errors;
if(data101 !== null){
const err146 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/absolute_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err146];
}
else {
vErrors.push(err146);
}
errors++;
}
var _valid27 = _errs301 === errors;
valid55 = valid55 || _valid27;
}
if(!valid55){
const err147 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/absolute_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err147];
}
else {
vErrors.push(err147);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs298;
if(vErrors !== null){
if(_errs298){
vErrors.length = _errs298;
}
else {
vErrors = null;
}
}
}
var valid54 = _errs297 === errors;
}
else {
var valid54 = true;
}
if(valid54){
if(data99.relative_wealth_pct !== undefined && func0.call(data99, "relative_wealth_pct")){
let data102 = data99.relative_wealth_pct;
const _errs303 = errors;
const _errs304 = errors;
let valid56 = false;
const _errs305 = errors;
if(errors === _errs305){
if((typeof data102 == "number") && (isFinite(data102))){
if(data102 < -100 || isNaN(data102)){
const err148 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/relative_wealth_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err148];
}
else {
vErrors.push(err148);
}
errors++;
}
}
else {
const err149 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/relative_wealth_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err149];
}
else {
vErrors.push(err149);
}
errors++;
}
}
var _valid28 = _errs305 === errors;
valid56 = valid56 || _valid28;
if(!valid56){
const _errs307 = errors;
if(data102 !== null){
const err150 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/relative_wealth_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err150];
}
else {
vErrors.push(err150);
}
errors++;
}
var _valid28 = _errs307 === errors;
valid56 = valid56 || _valid28;
}
if(!valid56){
const err151 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/relative_wealth_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err151];
}
else {
vErrors.push(err151);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs304;
if(vErrors !== null){
if(_errs304){
vErrors.length = _errs304;
}
else {
vErrors = null;
}
}
}
var valid54 = _errs303 === errors;
}
else {
var valid54 = true;
}
if(valid54){
if(data99.null_reasons !== undefined && func0.call(data99, "null_reasons")){
let data103 = data99.null_reasons;
const _errs309 = errors;
if(errors === _errs309){
if(data103 && typeof data103 == "object" && !Array.isArray(data103)){
let missing25;
if((((data103.absolute_return_pct === undefined) || (!(func0.call(data103, "absolute_return_pct")))) && (missing25 = "absolute_return_pct")) || (((data103.relative_wealth_pct === undefined) || (!(func0.call(data103, "relative_wealth_pct")))) && (missing25 = "relative_wealth_pct"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/required",keyword:"required",params:{missingProperty: missing25},message:"must have required property '"+missing25+"'"}];
return false;
}
else {
const _errs311 = errors;
for(const key25 of Object.keys(data103)){
if(!((key25 === "absolute_return_pct") || (key25 === "relative_wealth_pct"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key25},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs311 === errors){
if(data103.absolute_return_pct !== undefined && func0.call(data103, "absolute_return_pct")){
let data104 = data103.absolute_return_pct;
const _errs312 = errors;
const _errs313 = errors;
let valid58 = false;
const _errs314 = errors;
if(!((((((((((((((data104 === "missing_input") || (data104 === "non_finite_input")) || (data104 === "invalid_price")) || (data104 === "benchmark_missing")) || (data104 === "benchmark_invalid")) || (data104 === "insufficient_reference_history")) || (data104 === "empty_panel")) || (data104 === "future_tail")) || (data104 === "source_session_mismatch")) || (data104 === "ambiguous_duplicate_price_index")) || (data104 === "ambiguous_duplicate_column")) || (data104 === "cohort_identity_mismatch")) || (data104 === "benchmark_identity_mismatch")) || (data104 === "return_basis_not_qualified"))){
const err152 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/properties/absolute_return_pct/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["20"].properties.null_reasons.properties.absolute_return_pct.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err152];
}
else {
vErrors.push(err152);
}
errors++;
}
var _valid29 = _errs314 === errors;
valid58 = valid58 || _valid29;
if(!valid58){
const _errs315 = errors;
if(data104 !== null){
const err153 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/properties/absolute_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err153];
}
else {
vErrors.push(err153);
}
errors++;
}
var _valid29 = _errs315 === errors;
valid58 = valid58 || _valid29;
}
if(!valid58){
const err154 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/properties/absolute_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err154];
}
else {
vErrors.push(err154);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs313;
if(vErrors !== null){
if(_errs313){
vErrors.length = _errs313;
}
else {
vErrors = null;
}
}
}
var valid57 = _errs312 === errors;
}
else {
var valid57 = true;
}
if(valid57){
if(data103.relative_wealth_pct !== undefined && func0.call(data103, "relative_wealth_pct")){
let data105 = data103.relative_wealth_pct;
const _errs317 = errors;
const _errs318 = errors;
let valid59 = false;
const _errs319 = errors;
if(!((((((((((((((data105 === "missing_input") || (data105 === "non_finite_input")) || (data105 === "invalid_price")) || (data105 === "benchmark_missing")) || (data105 === "benchmark_invalid")) || (data105 === "insufficient_reference_history")) || (data105 === "empty_panel")) || (data105 === "future_tail")) || (data105 === "source_session_mismatch")) || (data105 === "ambiguous_duplicate_price_index")) || (data105 === "ambiguous_duplicate_column")) || (data105 === "cohort_identity_mismatch")) || (data105 === "benchmark_identity_mismatch")) || (data105 === "return_basis_not_qualified"))){
const err155 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/properties/relative_wealth_pct/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["20"].properties.null_reasons.properties.relative_wealth_pct.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err155];
}
else {
vErrors.push(err155);
}
errors++;
}
var _valid30 = _errs319 === errors;
valid59 = valid59 || _valid30;
if(!valid59){
const _errs320 = errors;
if(data105 !== null){
const err156 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/properties/relative_wealth_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err156];
}
else {
vErrors.push(err156);
}
errors++;
}
var _valid30 = _errs320 === errors;
valid59 = valid59 || _valid30;
}
if(!valid59){
const err157 = {instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/properties/relative_wealth_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err157];
}
else {
vErrors.push(err157);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs318;
if(vErrors !== null){
if(_errs318){
vErrors.length = _errs318;
}
else {
vErrors = null;
}
}
}
var valid57 = _errs317 === errors;
}
else {
var valid57 = true;
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/null_reasons/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid54 = _errs309 === errors;
}
else {
var valid54 = true;
}
if(valid54){
if(data99.coverage !== undefined && func0.call(data99, "coverage")){
let data106 = data99.coverage;
const _errs322 = errors;
if(errors === _errs322){
if(data106 && typeof data106 == "object" && !Array.isArray(data106)){
let missing26;
if(((((data106.observed_n === undefined) || (!(func0.call(data106, "observed_n")))) && (missing26 = "observed_n")) || (((data106.expected_n === undefined) || (!(func0.call(data106, "expected_n")))) && (missing26 = "expected_n"))) || (((data106.ratio === undefined) || (!(func0.call(data106, "ratio")))) && (missing26 = "ratio"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/required",keyword:"required",params:{missingProperty: missing26},message:"must have required property '"+missing26+"'"}];
return false;
}
else {
const _errs324 = errors;
for(const key26 of Object.keys(data106)){
if(!(((key26 === "observed_n") || (key26 === "expected_n")) || (key26 === "ratio"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key26},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs324 === errors){
if(data106.observed_n !== undefined && func0.call(data106, "observed_n")){
let data107 = data106.observed_n;
const _errs325 = errors;
if(!(((typeof data107 == "number") && (!(data107 % 1) && !isNaN(data107))) && (isFinite(data107)))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/observed_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs325){
if((typeof data107 == "number") && (isFinite(data107))){
if(data107 > 64 || isNaN(data107)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/observed_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data107 < 0 || isNaN(data107)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/observed_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid60 = _errs325 === errors;
}
else {
var valid60 = true;
}
if(valid60){
if(data106.expected_n !== undefined && func0.call(data106, "expected_n")){
let data108 = data106.expected_n;
const _errs327 = errors;
if(!(((typeof data108 == "number") && (!(data108 % 1) && !isNaN(data108))) && (isFinite(data108)))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/expected_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs327){
if((typeof data108 == "number") && (isFinite(data108))){
if(data108 > 64 || isNaN(data108)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/expected_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data108 < 0 || isNaN(data108)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/expected_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid60 = _errs327 === errors;
}
else {
var valid60 = true;
}
if(valid60){
if(data106.ratio !== undefined && func0.call(data106, "ratio")){
let data109 = data106.ratio;
const _errs329 = errors;
if(errors === _errs329){
if((typeof data109 == "number") && (isFinite(data109))){
if(data109 > 1 || isNaN(data109)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/ratio/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"}];
return false;
}
else {
if(data109 < 0 || isNaN(data109)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/ratio/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/properties/ratio/type",keyword:"type",params:{type: "number"},message:"must be number"}];
return false;
}
}
var valid60 = _errs329 === errors;
}
else {
var valid60 = true;
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/20/properties/coverage/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid54 = _errs322 === errors;
}
else {
var valid54 = true;
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/20",schemaPath:"#/properties/groups/items/properties/windows/properties/20/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid46 = _errs293 === errors;
}
else {
var valid46 = true;
}
if(valid46){
if(data87["63"] !== undefined && func0.call(data87, "63")){
let data110 = data87["63"];
const _errs331 = errors;
if(errors === _errs331){
if(data110 && typeof data110 == "object" && !Array.isArray(data110)){
let missing27;
if(((((((data110.status === undefined) || (!(func0.call(data110, "status")))) && (missing27 = "status")) || (((data110.absolute_return_pct === undefined) || (!(func0.call(data110, "absolute_return_pct")))) && (missing27 = "absolute_return_pct"))) || (((data110.relative_wealth_pct === undefined) || (!(func0.call(data110, "relative_wealth_pct")))) && (missing27 = "relative_wealth_pct"))) || (((data110.null_reasons === undefined) || (!(func0.call(data110, "null_reasons")))) && (missing27 = "null_reasons"))) || (((data110.coverage === undefined) || (!(func0.call(data110, "coverage")))) && (missing27 = "coverage"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63",schemaPath:"#/properties/groups/items/properties/windows/properties/63/required",keyword:"required",params:{missingProperty: missing27},message:"must have required property '"+missing27+"'"}];
return false;
}
else {
const _errs333 = errors;
for(const key27 of Object.keys(data110)){
if(!(((((key27 === "status") || (key27 === "absolute_return_pct")) || (key27 === "relative_wealth_pct")) || (key27 === "null_reasons")) || (key27 === "coverage"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63",schemaPath:"#/properties/groups/items/properties/windows/properties/63/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key27},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs333 === errors){
if(data110.status !== undefined && func0.call(data110, "status")){
let data111 = data110.status;
const _errs334 = errors;
if(!(((data111 === "available") || (data111 === "partial")) || (data111 === "unavailable"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/status",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/status/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["63"].properties.status.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid61 = _errs334 === errors;
}
else {
var valid61 = true;
}
if(valid61){
if(data110.absolute_return_pct !== undefined && func0.call(data110, "absolute_return_pct")){
let data112 = data110.absolute_return_pct;
const _errs335 = errors;
const _errs336 = errors;
let valid62 = false;
const _errs337 = errors;
if(errors === _errs337){
if((typeof data112 == "number") && (isFinite(data112))){
if(data112 < -100 || isNaN(data112)){
const err158 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/absolute_return_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err158];
}
else {
vErrors.push(err158);
}
errors++;
}
}
else {
const err159 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/absolute_return_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err159];
}
else {
vErrors.push(err159);
}
errors++;
}
}
var _valid31 = _errs337 === errors;
valid62 = valid62 || _valid31;
if(!valid62){
const _errs339 = errors;
if(data112 !== null){
const err160 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/absolute_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err160];
}
else {
vErrors.push(err160);
}
errors++;
}
var _valid31 = _errs339 === errors;
valid62 = valid62 || _valid31;
}
if(!valid62){
const err161 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/absolute_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err161];
}
else {
vErrors.push(err161);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs336;
if(vErrors !== null){
if(_errs336){
vErrors.length = _errs336;
}
else {
vErrors = null;
}
}
}
var valid61 = _errs335 === errors;
}
else {
var valid61 = true;
}
if(valid61){
if(data110.relative_wealth_pct !== undefined && func0.call(data110, "relative_wealth_pct")){
let data113 = data110.relative_wealth_pct;
const _errs341 = errors;
const _errs342 = errors;
let valid63 = false;
const _errs343 = errors;
if(errors === _errs343){
if((typeof data113 == "number") && (isFinite(data113))){
if(data113 < -100 || isNaN(data113)){
const err162 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/relative_wealth_pct/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: -100},message:"must be >= -100"};
if(vErrors === null){
vErrors = [err162];
}
else {
vErrors.push(err162);
}
errors++;
}
}
else {
const err163 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/relative_wealth_pct/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err163];
}
else {
vErrors.push(err163);
}
errors++;
}
}
var _valid32 = _errs343 === errors;
valid63 = valid63 || _valid32;
if(!valid63){
const _errs345 = errors;
if(data113 !== null){
const err164 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/relative_wealth_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err164];
}
else {
vErrors.push(err164);
}
errors++;
}
var _valid32 = _errs345 === errors;
valid63 = valid63 || _valid32;
}
if(!valid63){
const err165 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/relative_wealth_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err165];
}
else {
vErrors.push(err165);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs342;
if(vErrors !== null){
if(_errs342){
vErrors.length = _errs342;
}
else {
vErrors = null;
}
}
}
var valid61 = _errs341 === errors;
}
else {
var valid61 = true;
}
if(valid61){
if(data110.null_reasons !== undefined && func0.call(data110, "null_reasons")){
let data114 = data110.null_reasons;
const _errs347 = errors;
if(errors === _errs347){
if(data114 && typeof data114 == "object" && !Array.isArray(data114)){
let missing28;
if((((data114.absolute_return_pct === undefined) || (!(func0.call(data114, "absolute_return_pct")))) && (missing28 = "absolute_return_pct")) || (((data114.relative_wealth_pct === undefined) || (!(func0.call(data114, "relative_wealth_pct")))) && (missing28 = "relative_wealth_pct"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/required",keyword:"required",params:{missingProperty: missing28},message:"must have required property '"+missing28+"'"}];
return false;
}
else {
const _errs349 = errors;
for(const key28 of Object.keys(data114)){
if(!((key28 === "absolute_return_pct") || (key28 === "relative_wealth_pct"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key28},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs349 === errors){
if(data114.absolute_return_pct !== undefined && func0.call(data114, "absolute_return_pct")){
let data115 = data114.absolute_return_pct;
const _errs350 = errors;
const _errs351 = errors;
let valid65 = false;
const _errs352 = errors;
if(!((((((((((((((data115 === "missing_input") || (data115 === "non_finite_input")) || (data115 === "invalid_price")) || (data115 === "benchmark_missing")) || (data115 === "benchmark_invalid")) || (data115 === "insufficient_reference_history")) || (data115 === "empty_panel")) || (data115 === "future_tail")) || (data115 === "source_session_mismatch")) || (data115 === "ambiguous_duplicate_price_index")) || (data115 === "ambiguous_duplicate_column")) || (data115 === "cohort_identity_mismatch")) || (data115 === "benchmark_identity_mismatch")) || (data115 === "return_basis_not_qualified"))){
const err166 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/properties/absolute_return_pct/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["63"].properties.null_reasons.properties.absolute_return_pct.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err166];
}
else {
vErrors.push(err166);
}
errors++;
}
var _valid33 = _errs352 === errors;
valid65 = valid65 || _valid33;
if(!valid65){
const _errs353 = errors;
if(data115 !== null){
const err167 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/properties/absolute_return_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err167];
}
else {
vErrors.push(err167);
}
errors++;
}
var _valid33 = _errs353 === errors;
valid65 = valid65 || _valid33;
}
if(!valid65){
const err168 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons/absolute_return_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/properties/absolute_return_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err168];
}
else {
vErrors.push(err168);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs351;
if(vErrors !== null){
if(_errs351){
vErrors.length = _errs351;
}
else {
vErrors = null;
}
}
}
var valid64 = _errs350 === errors;
}
else {
var valid64 = true;
}
if(valid64){
if(data114.relative_wealth_pct !== undefined && func0.call(data114, "relative_wealth_pct")){
let data116 = data114.relative_wealth_pct;
const _errs355 = errors;
const _errs356 = errors;
let valid66 = false;
const _errs357 = errors;
if(!((((((((((((((data116 === "missing_input") || (data116 === "non_finite_input")) || (data116 === "invalid_price")) || (data116 === "benchmark_missing")) || (data116 === "benchmark_invalid")) || (data116 === "insufficient_reference_history")) || (data116 === "empty_panel")) || (data116 === "future_tail")) || (data116 === "source_session_mismatch")) || (data116 === "ambiguous_duplicate_price_index")) || (data116 === "ambiguous_duplicate_column")) || (data116 === "cohort_identity_mismatch")) || (data116 === "benchmark_identity_mismatch")) || (data116 === "return_basis_not_qualified"))){
const err169 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/properties/relative_wealth_pct/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema12.properties.groups.items.properties.windows.properties["63"].properties.null_reasons.properties.relative_wealth_pct.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err169];
}
else {
vErrors.push(err169);
}
errors++;
}
var _valid34 = _errs357 === errors;
valid66 = valid66 || _valid34;
if(!valid66){
const _errs358 = errors;
if(data116 !== null){
const err170 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/properties/relative_wealth_pct/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err170];
}
else {
vErrors.push(err170);
}
errors++;
}
var _valid34 = _errs358 === errors;
valid66 = valid66 || _valid34;
}
if(!valid66){
const err171 = {instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons/relative_wealth_pct",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/properties/relative_wealth_pct/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err171];
}
else {
vErrors.push(err171);
}
errors++;
validate11.errors = vErrors;
return false;
}
else {
errors = _errs356;
if(vErrors !== null){
if(_errs356){
vErrors.length = _errs356;
}
else {
vErrors = null;
}
}
}
var valid64 = _errs355 === errors;
}
else {
var valid64 = true;
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/null_reasons",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/null_reasons/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid61 = _errs347 === errors;
}
else {
var valid61 = true;
}
if(valid61){
if(data110.coverage !== undefined && func0.call(data110, "coverage")){
let data117 = data110.coverage;
const _errs360 = errors;
if(errors === _errs360){
if(data117 && typeof data117 == "object" && !Array.isArray(data117)){
let missing29;
if(((((data117.observed_n === undefined) || (!(func0.call(data117, "observed_n")))) && (missing29 = "observed_n")) || (((data117.expected_n === undefined) || (!(func0.call(data117, "expected_n")))) && (missing29 = "expected_n"))) || (((data117.ratio === undefined) || (!(func0.call(data117, "ratio")))) && (missing29 = "ratio"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/required",keyword:"required",params:{missingProperty: missing29},message:"must have required property '"+missing29+"'"}];
return false;
}
else {
const _errs362 = errors;
for(const key29 of Object.keys(data117)){
if(!(((key29 === "observed_n") || (key29 === "expected_n")) || (key29 === "ratio"))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key29},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs362 === errors){
if(data117.observed_n !== undefined && func0.call(data117, "observed_n")){
let data118 = data117.observed_n;
const _errs363 = errors;
if(!(((typeof data118 == "number") && (!(data118 % 1) && !isNaN(data118))) && (isFinite(data118)))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/observed_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs363){
if((typeof data118 == "number") && (isFinite(data118))){
if(data118 > 64 || isNaN(data118)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/observed_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data118 < 0 || isNaN(data118)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/observed_n",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/observed_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid67 = _errs363 === errors;
}
else {
var valid67 = true;
}
if(valid67){
if(data117.expected_n !== undefined && func0.call(data117, "expected_n")){
let data119 = data117.expected_n;
const _errs365 = errors;
if(!(((typeof data119 == "number") && (!(data119 % 1) && !isNaN(data119))) && (isFinite(data119)))){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/expected_n/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs365){
if((typeof data119 == "number") && (isFinite(data119))){
if(data119 > 64 || isNaN(data119)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/expected_n/maximum",keyword:"maximum",params:{comparison: "<=", limit: 64},message:"must be <= 64"}];
return false;
}
else {
if(data119 < 0 || isNaN(data119)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/expected_n",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/expected_n/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid67 = _errs365 === errors;
}
else {
var valid67 = true;
}
if(valid67){
if(data117.ratio !== undefined && func0.call(data117, "ratio")){
let data120 = data117.ratio;
const _errs367 = errors;
if(errors === _errs367){
if((typeof data120 == "number") && (isFinite(data120))){
if(data120 > 1 || isNaN(data120)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/ratio/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"}];
return false;
}
else {
if(data120 < 0 || isNaN(data120)){
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/ratio/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage/ratio",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/properties/ratio/type",keyword:"type",params:{type: "number"},message:"must be number"}];
return false;
}
}
var valid67 = _errs367 === errors;
}
else {
var valid67 = true;
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63/coverage",schemaPath:"#/properties/groups/items/properties/windows/properties/63/properties/coverage/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid61 = _errs360 === errors;
}
else {
var valid61 = true;
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows/63",schemaPath:"#/properties/groups/items/properties/windows/properties/63/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid46 = _errs331 === errors;
}
else {
var valid46 = true;
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1+"/windows",schemaPath:"#/properties/groups/items/properties/windows/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid43 = _errs252 === errors;
}
else {
var valid43 = true;
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups/" + i1,schemaPath:"#/properties/groups/items/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid42 = _errs236 === errors;
if(!valid42){
break;
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/groups",schemaPath:"#/properties/groups/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid0 = _errs234 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.diagnostics !== undefined && func0.call(data, "diagnostics")){
let data121 = data.diagnostics;
const _errs369 = errors;
if(errors === _errs369){
if(data121 && typeof data121 == "object" && !Array.isArray(data121)){
let missing30;
if((((((((((((((((data121.panel_rows === undefined) || (!(func0.call(data121, "panel_rows")))) && (missing30 = "panel_rows")) || (((data121.malformed_rows === undefined) || (!(func0.call(data121, "malformed_rows")))) && (missing30 = "malformed_rows"))) || (((data121.duplicate_sessions === undefined) || (!(func0.call(data121, "duplicate_sessions")))) && (missing30 = "duplicate_sessions"))) || (((data121.ambiguous_columns === undefined) || (!(func0.call(data121, "ambiguous_columns")))) && (missing30 = "ambiguous_columns"))) || (((data121.columns === undefined) || (!(func0.call(data121, "columns")))) && (missing30 = "columns"))) || (((data121.binding_keys === undefined) || (!(func0.call(data121, "binding_keys")))) && (missing30 = "binding_keys"))) || (((data121.receipt_withheld === undefined) || (!(func0.call(data121, "receipt_withheld")))) && (missing30 = "receipt_withheld"))) || (((data121.future_tail_sessions === undefined) || (!(func0.call(data121, "future_tail_sessions")))) && (missing30 = "future_tail_sessions"))) || (((data121.expected_columns === undefined) || (!(func0.call(data121, "expected_columns")))) && (missing30 = "expected_columns"))) || (((data121.qualification_reasons === undefined) || (!(func0.call(data121, "qualification_reasons")))) && (missing30 = "qualification_reasons"))) || (((data121.measured_cells === undefined) || (!(func0.call(data121, "measured_cells")))) && (missing30 = "measured_cells"))) || (((data121.complete_cells === undefined) || (!(func0.call(data121, "complete_cells")))) && (missing30 = "complete_cells"))) || (((data121.total_cells === undefined) || (!(func0.call(data121, "total_cells")))) && (missing30 = "total_cells"))) || (((data121.coverage_note === undefined) || (!(func0.call(data121, "coverage_note")))) && (missing30 = "coverage_note"))){
validate11.errors = [{instancePath:instancePath+"/diagnostics",schemaPath:"#/properties/diagnostics/required",keyword:"required",params:{missingProperty: missing30},message:"must have required property '"+missing30+"'"}];
return false;
}
else {
const _errs371 = errors;
for(const key30 of Object.keys(data121)){
if(!(func0.call(schema12.properties.diagnostics.properties, key30))){
validate11.errors = [{instancePath:instancePath+"/diagnostics",schemaPath:"#/properties/diagnostics/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key30},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs371 === errors){
if(data121.panel_rows !== undefined && func0.call(data121, "panel_rows")){
let data122 = data121.panel_rows;
const _errs372 = errors;
if(!(((typeof data122 == "number") && (!(data122 % 1) && !isNaN(data122))) && (isFinite(data122)))){
validate11.errors = [{instancePath:instancePath+"/diagnostics/panel_rows",schemaPath:"#/properties/diagnostics/properties/panel_rows/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs372){
if((typeof data122 == "number") && (isFinite(data122))){
if(data122 > 20000 || isNaN(data122)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/panel_rows",schemaPath:"#/properties/diagnostics/properties/panel_rows/maximum",keyword:"maximum",params:{comparison: "<=", limit: 20000},message:"must be <= 20000"}];
return false;
}
else {
if(data122 < 0 || isNaN(data122)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/panel_rows",schemaPath:"#/properties/diagnostics/properties/panel_rows/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid68 = _errs372 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.malformed_rows !== undefined && func0.call(data121, "malformed_rows")){
let data123 = data121.malformed_rows;
const _errs374 = errors;
if(!(((typeof data123 == "number") && (!(data123 % 1) && !isNaN(data123))) && (isFinite(data123)))){
validate11.errors = [{instancePath:instancePath+"/diagnostics/malformed_rows",schemaPath:"#/properties/diagnostics/properties/malformed_rows/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs374){
if((typeof data123 == "number") && (isFinite(data123))){
if(data123 > 1000000000 || isNaN(data123)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/malformed_rows",schemaPath:"#/properties/diagnostics/properties/malformed_rows/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1000000000},message:"must be <= 1000000000"}];
return false;
}
else {
if(data123 < 0 || isNaN(data123)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/malformed_rows",schemaPath:"#/properties/diagnostics/properties/malformed_rows/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid68 = _errs374 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.duplicate_sessions !== undefined && func0.call(data121, "duplicate_sessions")){
let data124 = data121.duplicate_sessions;
const _errs376 = errors;
if(errors === _errs376){
if(Array.isArray(data124)){
if(data124.length > 16){
validate11.errors = [{instancePath:instancePath+"/diagnostics/duplicate_sessions",schemaPath:"#/properties/diagnostics/properties/duplicate_sessions/maxItems",keyword:"maxItems",params:{limit: 16},message:"must NOT have more than 16 items"}];
return false;
}
else {
var valid69 = true;
const len2 = data124.length;
for(let i2=0; i2<len2; i2++){
let data125 = data124[i2];
const _errs378 = errors;
if(errors === _errs378){
if(errors === _errs378){
if(typeof data125 === "string"){
if(!pattern12.test(data125)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/duplicate_sessions/" + i2,schemaPath:"#/properties/diagnostics/properties/duplicate_sessions/items/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""}];
return false;
}
else {
if(!(formats0.validate(data125))){
validate11.errors = [{instancePath:instancePath+"/diagnostics/duplicate_sessions/" + i2,schemaPath:"#/properties/diagnostics/properties/duplicate_sessions/items/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/duplicate_sessions/" + i2,schemaPath:"#/properties/diagnostics/properties/duplicate_sessions/items/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
}
var valid69 = _errs378 === errors;
if(!valid69){
break;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/duplicate_sessions",schemaPath:"#/properties/diagnostics/properties/duplicate_sessions/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid68 = _errs376 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.ambiguous_columns !== undefined && func0.call(data121, "ambiguous_columns")){
let data126 = data121.ambiguous_columns;
const _errs380 = errors;
if(errors === _errs380){
if(Array.isArray(data126)){
if(data126.length > 16){
validate11.errors = [{instancePath:instancePath+"/diagnostics/ambiguous_columns",schemaPath:"#/properties/diagnostics/properties/ambiguous_columns/maxItems",keyword:"maxItems",params:{limit: 16},message:"must NOT have more than 16 items"}];
return false;
}
else {
var valid70 = true;
const len3 = data126.length;
for(let i3=0; i3<len3; i3++){
let data127 = data126[i3];
const _errs382 = errors;
if(errors === _errs382){
if(typeof data127 === "string"){
if(func97(data127) > 64){
validate11.errors = [{instancePath:instancePath+"/diagnostics/ambiguous_columns/" + i3,schemaPath:"#/properties/diagnostics/properties/ambiguous_columns/items/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"}];
return false;
}
else {
if(func97(data127) < 1){
validate11.errors = [{instancePath:instancePath+"/diagnostics/ambiguous_columns/" + i3,schemaPath:"#/properties/diagnostics/properties/ambiguous_columns/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"}];
return false;
}
else {
if(!pattern2.test(data127)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/ambiguous_columns/" + i3,schemaPath:"#/properties/diagnostics/properties/ambiguous_columns/items/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""}];
return false;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/ambiguous_columns/" + i3,schemaPath:"#/properties/diagnostics/properties/ambiguous_columns/items/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
var valid70 = _errs382 === errors;
if(!valid70){
break;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/ambiguous_columns",schemaPath:"#/properties/diagnostics/properties/ambiguous_columns/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid68 = _errs380 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.columns !== undefined && func0.call(data121, "columns")){
let data128 = data121.columns;
const _errs384 = errors;
if(errors === _errs384){
if(Array.isArray(data128)){
if(data128.length > 64){
validate11.errors = [{instancePath:instancePath+"/diagnostics/columns",schemaPath:"#/properties/diagnostics/properties/columns/maxItems",keyword:"maxItems",params:{limit: 64},message:"must NOT have more than 64 items"}];
return false;
}
else {
var valid71 = true;
const len4 = data128.length;
for(let i4=0; i4<len4; i4++){
let data129 = data128[i4];
const _errs386 = errors;
if(errors === _errs386){
if(typeof data129 === "string"){
if(func97(data129) > 64){
validate11.errors = [{instancePath:instancePath+"/diagnostics/columns/" + i4,schemaPath:"#/properties/diagnostics/properties/columns/items/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"}];
return false;
}
else {
if(func97(data129) < 1){
validate11.errors = [{instancePath:instancePath+"/diagnostics/columns/" + i4,schemaPath:"#/properties/diagnostics/properties/columns/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"}];
return false;
}
else {
if(!pattern2.test(data129)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/columns/" + i4,schemaPath:"#/properties/diagnostics/properties/columns/items/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""}];
return false;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/columns/" + i4,schemaPath:"#/properties/diagnostics/properties/columns/items/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
var valid71 = _errs386 === errors;
if(!valid71){
break;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/columns",schemaPath:"#/properties/diagnostics/properties/columns/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid68 = _errs384 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.binding_keys !== undefined && func0.call(data121, "binding_keys")){
let data130 = data121.binding_keys;
const _errs388 = errors;
if(errors === _errs388){
if(Array.isArray(data130)){
if(data130.length > 8){
validate11.errors = [{instancePath:instancePath+"/diagnostics/binding_keys",schemaPath:"#/properties/diagnostics/properties/binding_keys/maxItems",keyword:"maxItems",params:{limit: 8},message:"must NOT have more than 8 items"}];
return false;
}
else {
var valid72 = true;
const len5 = data130.length;
for(let i5=0; i5<len5; i5++){
let data131 = data130[i5];
const _errs390 = errors;
if(!(((((((data131 === "source_roots") || (data131 === "clocks")) || (data131 === "receipt")) || (data131 === "cohort_id")) || (data131 === "benchmark")) || (data131 === "source_session")) || (data131 === "price_basis"))){
validate11.errors = [{instancePath:instancePath+"/diagnostics/binding_keys/" + i5,schemaPath:"#/properties/diagnostics/properties/binding_keys/items/enum",keyword:"enum",params:{allowedValues: schema12.properties.diagnostics.properties.binding_keys.items.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid72 = _errs390 === errors;
if(!valid72){
break;
}
}
if(valid72){
let i6 = data130.length;
let j0;
if(i6 > 1){
outer0:
for(;i6--;){
for(j0 = i6; j0--;){
if(func32(data130[i6], data130[j0])){
validate11.errors = [{instancePath:instancePath+"/diagnostics/binding_keys",schemaPath:"#/properties/diagnostics/properties/binding_keys/uniqueItems",keyword:"uniqueItems",params:{i: i6, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i6+" are identical)"}];
return false;
break outer0;
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/binding_keys",schemaPath:"#/properties/diagnostics/properties/binding_keys/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid68 = _errs388 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.receipt_withheld !== undefined && func0.call(data121, "receipt_withheld")){
const _errs391 = errors;
if(typeof data121.receipt_withheld !== "boolean"){
validate11.errors = [{instancePath:instancePath+"/diagnostics/receipt_withheld",schemaPath:"#/properties/diagnostics/properties/receipt_withheld/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"}];
return false;
}
var valid68 = _errs391 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.future_tail_sessions !== undefined && func0.call(data121, "future_tail_sessions")){
let data133 = data121.future_tail_sessions;
const _errs393 = errors;
if(errors === _errs393){
if(Array.isArray(data133)){
if(data133.length > 16){
validate11.errors = [{instancePath:instancePath+"/diagnostics/future_tail_sessions",schemaPath:"#/properties/diagnostics/properties/future_tail_sessions/maxItems",keyword:"maxItems",params:{limit: 16},message:"must NOT have more than 16 items"}];
return false;
}
else {
var valid74 = true;
const len6 = data133.length;
for(let i7=0; i7<len6; i7++){
let data134 = data133[i7];
const _errs395 = errors;
if(errors === _errs395){
if(errors === _errs395){
if(typeof data134 === "string"){
if(!pattern12.test(data134)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/future_tail_sessions/" + i7,schemaPath:"#/properties/diagnostics/properties/future_tail_sessions/items/pattern",keyword:"pattern",params:{pattern: "^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"},message:"must match pattern \""+"^(?!0000)\\d{4}-\\d{2}-\\d{2}(?![\\s\\S])"+"\""}];
return false;
}
else {
if(!(formats0.validate(data134))){
validate11.errors = [{instancePath:instancePath+"/diagnostics/future_tail_sessions/" + i7,schemaPath:"#/properties/diagnostics/properties/future_tail_sessions/items/format",keyword:"format",params:{format: "date"},message:"must match format \""+"date"+"\""}];
return false;
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/future_tail_sessions/" + i7,schemaPath:"#/properties/diagnostics/properties/future_tail_sessions/items/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
}
var valid74 = _errs395 === errors;
if(!valid74){
break;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/future_tail_sessions",schemaPath:"#/properties/diagnostics/properties/future_tail_sessions/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid68 = _errs393 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.expected_columns !== undefined && func0.call(data121, "expected_columns")){
const _errs397 = errors;
if(12 !== data121.expected_columns){
validate11.errors = [{instancePath:instancePath+"/diagnostics/expected_columns",schemaPath:"#/properties/diagnostics/properties/expected_columns/const",keyword:"const",params:{allowedValue: 12},message:"must be equal to constant"}];
return false;
}
var valid68 = _errs397 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.qualification_reasons !== undefined && func0.call(data121, "qualification_reasons")){
let data136 = data121.qualification_reasons;
const _errs398 = errors;
if(errors === _errs398){
if(Array.isArray(data136)){
if(data136.length > 8){
validate11.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons",schemaPath:"#/properties/diagnostics/properties/qualification_reasons/maxItems",keyword:"maxItems",params:{limit: 8},message:"must NOT have more than 8 items"}];
return false;
}
else {
var valid75 = true;
const len7 = data136.length;
for(let i8=0; i8<len7; i8++){
let data137 = data136[i8];
const _errs400 = errors;
if(!((((((((data137 === "empty_panel") || (data137 === "future_tail")) || (data137 === "source_session_mismatch")) || (data137 === "ambiguous_duplicate_price_index")) || (data137 === "ambiguous_duplicate_column")) || (data137 === "cohort_identity_mismatch")) || (data137 === "benchmark_identity_mismatch")) || (data137 === "return_basis_not_qualified"))){
validate11.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons/" + i8,schemaPath:"#/properties/diagnostics/properties/qualification_reasons/items/enum",keyword:"enum",params:{allowedValues: schema12.properties.diagnostics.properties.qualification_reasons.items.enum},message:"must be equal to one of the allowed values"}];
return false;
}
var valid75 = _errs400 === errors;
if(!valid75){
break;
}
}
if(valid75){
let i9 = data136.length;
let j1;
if(i9 > 1){
outer1:
for(;i9--;){
for(j1 = i9; j1--;){
if(func32(data136[i9], data136[j1])){
validate11.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons",schemaPath:"#/properties/diagnostics/properties/qualification_reasons/uniqueItems",keyword:"uniqueItems",params:{i: i9, j: j1},message:"must NOT have duplicate items (items ## "+j1+" and "+i9+" are identical)"}];
return false;
break outer1;
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/qualification_reasons",schemaPath:"#/properties/diagnostics/properties/qualification_reasons/type",keyword:"type",params:{type: "array"},message:"must be array"}];
return false;
}
}
var valid68 = _errs398 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.measured_cells !== undefined && func0.call(data121, "measured_cells")){
let data138 = data121.measured_cells;
const _errs401 = errors;
if(!(((typeof data138 == "number") && (!(data138 % 1) && !isNaN(data138))) && (isFinite(data138)))){
validate11.errors = [{instancePath:instancePath+"/diagnostics/measured_cells",schemaPath:"#/properties/diagnostics/properties/measured_cells/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs401){
if((typeof data138 == "number") && (isFinite(data138))){
if(data138 > 33 || isNaN(data138)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/measured_cells",schemaPath:"#/properties/diagnostics/properties/measured_cells/maximum",keyword:"maximum",params:{comparison: "<=", limit: 33},message:"must be <= 33"}];
return false;
}
else {
if(data138 < 0 || isNaN(data138)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/measured_cells",schemaPath:"#/properties/diagnostics/properties/measured_cells/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid68 = _errs401 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.complete_cells !== undefined && func0.call(data121, "complete_cells")){
let data139 = data121.complete_cells;
const _errs403 = errors;
if(!(((typeof data139 == "number") && (!(data139 % 1) && !isNaN(data139))) && (isFinite(data139)))){
validate11.errors = [{instancePath:instancePath+"/diagnostics/complete_cells",schemaPath:"#/properties/diagnostics/properties/complete_cells/type",keyword:"type",params:{type: "integer"},message:"must be integer"}];
return false;
}
if(errors === _errs403){
if((typeof data139 == "number") && (isFinite(data139))){
if(data139 > 33 || isNaN(data139)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/complete_cells",schemaPath:"#/properties/diagnostics/properties/complete_cells/maximum",keyword:"maximum",params:{comparison: "<=", limit: 33},message:"must be <= 33"}];
return false;
}
else {
if(data139 < 0 || isNaN(data139)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/complete_cells",schemaPath:"#/properties/diagnostics/properties/complete_cells/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"}];
return false;
}
}
}
}
var valid68 = _errs403 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.total_cells !== undefined && func0.call(data121, "total_cells")){
const _errs405 = errors;
if(33 !== data121.total_cells){
validate11.errors = [{instancePath:instancePath+"/diagnostics/total_cells",schemaPath:"#/properties/diagnostics/properties/total_cells/const",keyword:"const",params:{allowedValue: 33},message:"must be equal to constant"}];
return false;
}
var valid68 = _errs405 === errors;
}
else {
var valid68 = true;
}
if(valid68){
if(data121.coverage_note !== undefined && func0.call(data121, "coverage_note")){
let data141 = data121.coverage_note;
const _errs406 = errors;
if(errors === _errs406){
if(typeof data141 === "string"){
if(func97(data141) > 512){
validate11.errors = [{instancePath:instancePath+"/diagnostics/coverage_note",schemaPath:"#/properties/diagnostics/properties/coverage_note/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"}];
return false;
}
else {
if(func97(data141) < 1){
validate11.errors = [{instancePath:instancePath+"/diagnostics/coverage_note",schemaPath:"#/properties/diagnostics/properties/coverage_note/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"}];
return false;
}
else {
if(!pattern2.test(data141)){
validate11.errors = [{instancePath:instancePath+"/diagnostics/coverage_note",schemaPath:"#/properties/diagnostics/properties/coverage_note/pattern",keyword:"pattern",params:{pattern: "^[^\\u0000-\\u001f]+(?![\\s\\S])"},message:"must match pattern \""+"^[^\\u0000-\\u001f]+(?![\\s\\S])"+"\""}];
return false;
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics/coverage_note",schemaPath:"#/properties/diagnostics/properties/coverage_note/type",keyword:"type",params:{type: "string"},message:"must be string"}];
return false;
}
}
var valid68 = _errs406 === errors;
}
else {
var valid68 = true;
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/diagnostics",schemaPath:"#/properties/diagnostics/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs369 === errors;
}
else {
var valid0 = true;
}
if(valid0){
if(data.authority !== undefined && func0.call(data, "authority")){
let data142 = data.authority;
const _errs408 = errors;
if(errors === _errs408){
if(data142 && typeof data142 == "object" && !Array.isArray(data142)){
let missing31;
if(((((((data142.may_rank === undefined) || (!(func0.call(data142, "may_rank")))) && (missing31 = "may_rank")) || (((data142.may_gate === undefined) || (!(func0.call(data142, "may_gate")))) && (missing31 = "may_gate"))) || (((data142.may_size === undefined) || (!(func0.call(data142, "may_size")))) && (missing31 = "may_size"))) || (((data142.may_trade === undefined) || (!(func0.call(data142, "may_trade")))) && (missing31 = "may_trade"))) || (((data142.may_escalate === undefined) || (!(func0.call(data142, "may_escalate")))) && (missing31 = "may_escalate"))){
validate11.errors = [{instancePath:instancePath+"/authority",schemaPath:"#/properties/authority/required",keyword:"required",params:{missingProperty: missing31},message:"must have required property '"+missing31+"'"}];
return false;
}
else {
const _errs410 = errors;
for(const key31 of Object.keys(data142)){
if(!(((((key31 === "may_rank") || (key31 === "may_gate")) || (key31 === "may_size")) || (key31 === "may_trade")) || (key31 === "may_escalate"))){
validate11.errors = [{instancePath:instancePath+"/authority",schemaPath:"#/properties/authority/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key31},message:"must NOT have additional properties"}];
return false;
break;
}
}
if(_errs410 === errors){
if(data142.may_rank !== undefined && func0.call(data142, "may_rank")){
const _errs411 = errors;
if(false !== data142.may_rank){
validate11.errors = [{instancePath:instancePath+"/authority/may_rank",schemaPath:"#/properties/authority/properties/may_rank/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid77 = _errs411 === errors;
}
else {
var valid77 = true;
}
if(valid77){
if(data142.may_gate !== undefined && func0.call(data142, "may_gate")){
const _errs412 = errors;
if(false !== data142.may_gate){
validate11.errors = [{instancePath:instancePath+"/authority/may_gate",schemaPath:"#/properties/authority/properties/may_gate/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid77 = _errs412 === errors;
}
else {
var valid77 = true;
}
if(valid77){
if(data142.may_size !== undefined && func0.call(data142, "may_size")){
const _errs413 = errors;
if(false !== data142.may_size){
validate11.errors = [{instancePath:instancePath+"/authority/may_size",schemaPath:"#/properties/authority/properties/may_size/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid77 = _errs413 === errors;
}
else {
var valid77 = true;
}
if(valid77){
if(data142.may_trade !== undefined && func0.call(data142, "may_trade")){
const _errs414 = errors;
if(false !== data142.may_trade){
validate11.errors = [{instancePath:instancePath+"/authority/may_trade",schemaPath:"#/properties/authority/properties/may_trade/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid77 = _errs414 === errors;
}
else {
var valid77 = true;
}
if(valid77){
if(data142.may_escalate !== undefined && func0.call(data142, "may_escalate")){
const _errs415 = errors;
if(false !== data142.may_escalate){
validate11.errors = [{instancePath:instancePath+"/authority/may_escalate",schemaPath:"#/properties/authority/properties/may_escalate/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"}];
return false;
}
var valid77 = _errs415 === errors;
}
else {
var valid77 = true;
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath:instancePath+"/authority",schemaPath:"#/properties/authority/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
var valid0 = _errs408 === errors;
}
else {
var valid0 = true;
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
}
else {
validate11.errors = [{instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"}];
return false;
}
}
validate11.errors = vErrors;
return errors === 0;
}

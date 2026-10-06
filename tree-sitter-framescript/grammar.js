/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
  name: 'framescript',

  word: ($) => $.identifier,

  extras: ($) => [
    /\s/u,
    $.line_comment,
    $.block_comment,
  ],

  rules: {
    source_file: ($) => repeat($._declaration),

    _declaration: ($) => choice(
      $.import_declaration,
      $.constant_declaration,
      $.asset_declaration,
      $.font_declaration,
      $.composition_declaration,
    ),

    import_declaration: ($) => seq(
      'import',
      '{',
      optional(seq($.import_specifier, repeat(seq(',', $.import_specifier)), optional(','))),
      '}',
      'from',
      field('source', $.string_literal),
      optional(';'),
    ),

    import_specifier: ($) => seq(
      field('imported', $.identifier),
      optional(seq('as', field('local', $.identifier))),
    ),

    constant_declaration: ($) => seq(
      'let',
      field('name', $.identifier),
      '=',
      field('value', $._value),
      optional(';'),
    ),

    asset_declaration: ($) => seq(
      'asset',
      field('name', $.identifier),
      field('body', $.resource_body),
    ),

    font_declaration: ($) => seq(
      'font',
      field('name', $.identifier),
      field('body', $.resource_body),
    ),

    resource_body: ($) => seq('{', repeat($.property_declaration), '}'),

    composition_declaration: ($) => seq(
      'composition',
      field('name', $.identifier),
      field('body', $.composition_body),
    ),

    composition_body: ($) => seq(
      '{',
      repeat(choice($.property_declaration, $.layer_declaration)),
      '}',
    ),

    layer_declaration: ($) => seq(
      field('type', $.layer_type),
      field('name', $.identifier),
      field('body', $.layer_body),
    ),

    layer_type: ($) => $.identifier,

    layer_body: ($) => seq(
      '{',
      repeat(choice(
        $.property_declaration,
        $.animation_declaration,
        $.layer_declaration,
      )),
      '}',
    ),

    property_declaration: ($) => seq(
      field('name', $.identifier),
      ':',
      field('value', $._value),
      optional(';'),
    ),

    animation_declaration: ($) => seq(
      'animate',
      field('property', $.identifier),
      '{',
      repeat($.keyframe),
      '}',
    ),

    keyframe: ($) => seq(
      field('time', $._value),
      ':',
      field('value', $._value),
      optional(seq('ease', field('easing', $.identifier))),
      optional(';'),
    ),

    _value: ($) => choice(
      $.unit_literal,
      $.number_literal,
      $.string_literal,
      $.boolean_literal,
      $.array_literal,
      $.identifier,
    ),

    array_literal: ($) => seq(
      '[',
      optional(seq($._value, repeat(seq(',', $._value)), optional(','))),
      ']',
    ),

    unit_literal: (_) => token(prec(2, /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:ms|s|f|px|pct|deg)/u)),
    number_literal: (_) => token(prec(1, /[+-]?(?:\d+(?:\.\d*)?|\.\d+)/u)),
    string_literal: (_) => token(choice(
      seq('"', repeat(choice(/[^"\\\n]+/u, /\\./u)), '"'),
      seq("'", repeat(choice(/[^'\\\n]+/u, /\\./u)), "'"),
    )),
    boolean_literal: (_) => choice('true', 'false'),
    identifier: (_) => /[A-Za-z_][A-Za-z0-9_-]*/u,

    line_comment: (_) => token(seq('//', /[^\n]*/u)),
    block_comment: (_) => token(seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/u, '/')),
  },
});

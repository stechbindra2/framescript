(line_comment) @comment
(block_comment) @comment
(string_literal) @string
(number_literal) @number
(unit_literal) @number
(boolean_literal) @boolean

["import" "from" "as" "let" "asset" "font" "composition" "animate" "ease"] @keyword
(layer_type) @type.builtin

(constant_declaration name: (identifier) @constant)
(import_specifier imported: (identifier) @constant)
(import_specifier local: (identifier) @constant)
(asset_declaration name: (identifier) @constant)
(font_declaration name: (identifier) @type)
(composition_declaration name: (identifier) @function)
(layer_declaration name: (identifier) @variable.member)
(property_declaration name: (identifier) @property)
(animation_declaration property: (identifier) @property)
(keyframe easing: (identifier) @function.builtin)

["{" "}" "[" "]"] @punctuation.bracket
[":" ";" "," "="] @punctuation.delimiter

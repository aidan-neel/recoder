import type { SymbolKind } from './types.js';

/** How one declaration node type becomes a symbol. */
interface DeclarationRule {
	kind: SymbolKind;
	/** Declarations inside it are qualified by its name (classes, modules, impls). */
	scope?: boolean;
	/** A scope that only qualifies its members and is not itself a symbol (a Rust `impl`). */
	hidden?: boolean;
}

/** What the symbol walker needs to know about one grammar. */
export interface GrammarSpec {
	/** Nodes walked through on the way to declarations, without qualifying their names. */
	transparent: Set<string>;
	declarations: Record<string, DeclarationRule>;
	/** Call node type → the field naming what it calls. */
	calls: Record<string, string>;
}

const TS_DECLARATIONS: Record<string, DeclarationRule> = {
	function_declaration: { kind: 'function' },
	generator_function_declaration: { kind: 'function' },
	class_declaration: { kind: 'class', scope: true },
	abstract_class_declaration: { kind: 'class', scope: true },
	method_definition: { kind: 'method' },
	abstract_method_signature: { kind: 'method' },
	public_field_definition: { kind: 'variable' },
	field_definition: { kind: 'variable' },
	interface_declaration: { kind: 'interface' },
	type_alias_declaration: { kind: 'type' },
	enum_declaration: { kind: 'type' },
	variable_declarator: { kind: 'variable' },
	internal_module: { kind: 'module', scope: true },
	module: { kind: 'module', scope: true }
};

const TS_SPEC: GrammarSpec = {
	transparent: new Set([
		'program',
		'export_statement',
		'ambient_declaration',
		'expression_statement',
		'lexical_declaration',
		'variable_declaration',
		'class_body',
		'statement_block'
	]),
	declarations: TS_DECLARATIONS,
	calls: { call_expression: 'function', new_expression: 'constructor' }
};

const SPECS: Record<string, GrammarSpec> = {
	typescript: TS_SPEC,
	tsx: TS_SPEC,
	javascript: TS_SPEC,
	svelte: TS_SPEC,
	python: {
		transparent: new Set(['module', 'decorated_definition', 'block', 'expression_statement']),
		declarations: {
			function_definition: { kind: 'function' },
			class_definition: { kind: 'class', scope: true },
			assignment: { kind: 'variable' }
		},
		calls: { call: 'function' }
	},
	go: {
		transparent: new Set(['source_file', 'type_declaration', 'var_declaration', 'const_declaration']),
		declarations: {
			function_declaration: { kind: 'function' },
			method_declaration: { kind: 'method' },
			type_spec: { kind: 'type' },
			var_spec: { kind: 'variable' },
			const_spec: { kind: 'variable' }
		},
		calls: { call_expression: 'function' }
	},
	rust: {
		transparent: new Set(['source_file', 'declaration_list']),
		declarations: {
			function_item: { kind: 'function' },
			function_signature_item: { kind: 'method' },
			struct_item: { kind: 'class' },
			enum_item: { kind: 'type' },
			union_item: { kind: 'type' },
			type_item: { kind: 'type' },
			trait_item: { kind: 'interface', scope: true },
			impl_item: { kind: 'class', scope: true, hidden: true },
			mod_item: { kind: 'module', scope: true },
			const_item: { kind: 'variable' },
			static_item: { kind: 'variable' },
			macro_definition: { kind: 'function' }
		},
		calls: { call_expression: 'function', macro_invocation: 'macro' }
	},
	java: {
		transparent: new Set(['program', 'class_body', 'interface_body', 'enum_body', 'enum_body_declarations']),
		declarations: {
			class_declaration: { kind: 'class', scope: true },
			record_declaration: { kind: 'class', scope: true },
			interface_declaration: { kind: 'interface', scope: true },
			annotation_type_declaration: { kind: 'interface' },
			enum_declaration: { kind: 'type', scope: true },
			method_declaration: { kind: 'method' },
			constructor_declaration: { kind: 'method' },
			field_declaration: { kind: 'variable' }
		},
		calls: { method_invocation: 'name', object_creation_expression: 'type' }
	},
	ruby: {
		transparent: new Set(['program', 'body_statement']),
		declarations: {
			class: { kind: 'class', scope: true },
			module: { kind: 'module', scope: true },
			method: { kind: 'method' },
			singleton_method: { kind: 'method' },
			assignment: { kind: 'variable' }
		},
		calls: { call: 'method' }
	}
};

/** Control flow that nests a block, across every grammar; an else-if continues its chain instead. */
export const CONTROL = new Set([
	'if_statement',
	'for_statement',
	'for_in_statement',
	'while_statement',
	'do_statement',
	'switch_statement',
	'try_statement',
	'with_statement',
	'match_statement',
	'if_expression',
	'for_expression',
	'while_expression',
	'loop_expression',
	'match_expression',
	'expression_switch_statement',
	'type_switch_statement',
	'select_statement',
	'enhanced_for_statement',
	'switch_expression',
	'try_with_resources_statement',
	'if',
	'unless',
	'while',
	'until',
	'for',
	'case',
	'begin',
	'arrow_function',
	'function_expression',
	'closure_expression',
	'func_literal',
	'lambda',
	'lambda_expression',
	'do_block'
]);

/** Values that make a variable or field a function. */
export const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);

/** Parameters that don't count toward a function's arity. */
export const RECEIVER_PARAMS = new Set([
	'self_parameter',
	'receiver_parameter',
	'comment',
	'line_comment',
	'block_comment'
]);

export function grammarSpec(language: string): GrammarSpec | null {
	return SPECS[language] ?? null;
}

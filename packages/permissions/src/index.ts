/**
 * Acesso só pela central Veritech (login único) — contrato: C:\ROBBY\docs\robby\sso-veritech.md.
 * Espelho do catálogo C:\ROBBY\config\acessos-catalogo\preventbase.json (mudou um, muda o outro).
 */
export const CATALOGO = {
  inicio: ["painel", "busca"],
  colaboradores: ["cadastro", "biometria"],
  entregas: ["entregas", "devolucoes"],
  epi: ["catalogo", "ca", "integracao_caepi"],
  estoque: ["saldos", "inventarios"],
  documentos: ["anexos"],
  relatorios: ["relatorios", "auditoria"],
  administracao: ["organizacao", "funcoes_epi", "almoxarifados", "dispositivos", "parametros", "lgpd"],
} as const;

export const ACOES = ["visualizar", "inserir", "alterar", "atualizar", "excluir", "enviar"] as const;
export type Acao = (typeof ACOES)[number];

type Catalogo = typeof CATALOGO;
export type Modulo = keyof Catalogo;
export type Tela = { [M in Modulo]: `${M}.${Catalogo[M][number]}` }[Modulo];
/** `modulo.submodulo.acao`; `*` = qualquer tela com visualizar (dados de apoio usados por várias telas). */
export type ChaveAcesso = `${Tela}.${Acao}` | "*";

/** Árvore `modulo → submodulo → {acao: boolean}` devolvida pela central. */
export type Permissoes = Record<string, Record<string, Partial<Record<Acao, boolean>>>>;

export interface Acesso {
  isAdmin: boolean;
  permissoes: Permissoes;
}

export const SEM_ACESSO: Acesso = { isAdmin: false, permissoes: {} };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Mantém só `true` explícitos com ids no formato do catálogo. */
export function normalizarPermissoes(raw: unknown): Permissoes {
  const out: Permissoes = {};
  if (!isObj(raw)) return out;
  for (const [mod, subs] of Object.entries(raw)) {
    if (!/^[a-z0-9_]{1,60}$/.test(mod) || !isObj(subs)) continue;
    for (const [sub, acoes] of Object.entries(subs)) {
      if (!/^[a-z0-9_]{1,60}$/.test(sub) || !isObj(acoes)) continue;
      const ok: Partial<Record<Acao, boolean>> = {};
      for (const a of ACOES) if (acoes[a] === true) ok[a] = true;
      if (Object.keys(ok).length) (out[mod] ??= {})[sub] = ok;
    }
  }
  return out;
}

export function pode(acesso: Acesso | null | undefined, ...chaves: ChaveAcesso[]): boolean {
  if (!acesso) return false;
  if (acesso.isAdmin) return true;
  return chaves.some((chave) => {
    if (chave === "*") return Object.values(acesso.permissoes).some((subs) => Object.values(subs).some((a) => a.visualizar === true));
    const [mod, sub, acao] = chave.split(".") as [string, string, Acao];
    return acesso.permissoes[mod]?.[sub]?.[acao] === true;
  });
}

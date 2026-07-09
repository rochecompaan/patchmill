export type ArtifactKind = "spec" | "plan";

export type ArtifactExtractionInlineSource<
  Kind extends ArtifactKind = ArtifactKind,
> = {
  kind: Kind;
  type: "inline";
  content: string;
  evidence: string;
  path?: string;
};

export type ArtifactExtractionSource<Kind extends ArtifactKind = ArtifactKind> =
  ArtifactExtractionInlineSource<Kind>;

export type ArtifactExtractionResult =
  | {
      status: "resolved";
      spec?: ArtifactExtractionSource<"spec">;
      plan?: ArtifactExtractionSource<"plan">;
    }
  | { status: "none" }
  | {
      status: "ambiguous";
      reason: string;
      candidates?: ArtifactExtractionSource[];
    };

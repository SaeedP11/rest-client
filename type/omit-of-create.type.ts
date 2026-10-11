import { DefaultOmitOfCreate } from "./default-omit-of-create.type";

export type OmitOfCreate<D> = Omit<D, DefaultOmitOfCreate>;

"use client";
import {createContext,useContext} from "react";
/** True only for a Portfolio page served with the historical execution schema enabled. */
export const PortfolioHistoryAccess=createContext(false);
export const usePortfolioHistoryAccess=()=>useContext(PortfolioHistoryAccess);

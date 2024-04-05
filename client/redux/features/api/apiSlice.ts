import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
// import build from "next/dist/build";

export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: process.env.NEXT_PUBLIC_SERVER_URI,
  }),
  endpoints: (builder) => ({}),
});

export const {} = apiSlice;

import { PayloadAction, configureStore, createSlice } from "@reduxjs/toolkit";
import { AppConfig } from "./model";

const configInitialState: {
    data: AppConfig | null
} = {
    data: null,
}

export const configSlice = createSlice({
    name: 'config',
    initialState: configInitialState,
    reducers: {
        updateConfig: (state, action: PayloadAction<AppConfig>) => {
            state.data = action.payload;
        },
    }
});

export const configStore = configureStore({
    reducer: {
        config: configSlice.reducer,
    },
});

export type ConfigState = ReturnType<typeof configStore.getState>
export type ConfigDispatch = typeof configStore.dispatch
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

export interface CourseState {
    selectedCourseId: number;
}

const courseInitialState: CourseState = {
    selectedCourseId: -1,
};

export const courseSlice = createSlice({
    name: 'course',
    initialState: courseInitialState,
    reducers: {
        setSelectedCourseId: (state, action: PayloadAction<number>) => {
            state.selectedCourseId = action.payload;
        },
    }
});

export const configStore = configureStore({
    reducer: {
        config: configSlice.reducer,
        course: courseSlice.reducer,
    },
});

export type ConfigState = ReturnType<typeof configStore.getState>
export type ConfigDispatch = typeof configStore.dispatch

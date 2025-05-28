

export const createPostProcessingSlice = (set) => ({

    isProcessing : null,
    title: "",

    updateProcessing:(permlink, title)=>{
        set({isProcessing: permlink,
            title:title
        })
    }
    
})

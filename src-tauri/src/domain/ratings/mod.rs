use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Rating(pub u8);

impl Rating {
    pub const MIN: u8 = 0;
    pub const MAX: u8 = 5;

    pub fn new(value: u8) -> Option<Self> {
        if value <= Self::MAX {
            Some(Self(value))
        } else {
            None
        }
    }
}
